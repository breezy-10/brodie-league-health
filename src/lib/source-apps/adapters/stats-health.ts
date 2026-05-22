import type { Adapter, AdapterResult, LMRollup } from "../types";
import { sourceClient, sourceConfigured } from "../clients";
import { ymd, daysAgo } from "../util";

/**
 * brodie-stats-health verified schema:
 *   profiles: id, email, full_name, role (lm|dm|finance|admin), active
 *   user_locations: user_id, location_id
 *   games: id, location_id, game_date, submitted_at, stats_completed (boolean),
 *          forfeit, status
 *
 * Sub-metric:
 *   stats_in_24h (100%) — % of last 14d games (non-forfeit, eligible) where
 *                          submitted_at - game_date <= 24h AND stats_completed = true.
 */
export const statsHealthAdapter: Adapter = {
  slug: "stats_health",
  async sync(snapshotDate: Date): Promise<AdapterResult> {
    if (!sourceConfigured("stats_health")) return { slug: "stats_health", rollups: [], unconfigured: true };
    const sb = sourceClient("stats_health")!;
    const fourteenAgo = ymd(daysAgo(snapshotDate, 14));

    const { data: profiles, error: pErr } = await sb
      .from("profiles")
      .select("id, email, full_name, role, active");
    if (pErr) return { slug: "stats_health", rollups: [], error: pErr.message };
    const lms = (profiles ?? []).filter(
      (p: { role: string; active: boolean }) => (p.role === "lm" || p.role === "dm") && p.active
    ) as Array<{ id: string; email: string }>;

    const rollups: LMRollup[] = [];
    for (const lm of lms) {
      const { data: links } = await sb
        .from("user_locations")
        .select("location_id")
        .eq("user_id", lm.id);
      const locationIds = (links ?? []).map((l: { location_id: string }) => l.location_id);

      const rollup: LMRollup = { lm_email: lm.email, metrics: [], action_items: [] };
      if (!locationIds.length) {
        rollup.metrics.push({ metric_slug: "stats_in_24h", raw_value: 100, max_score: 100, score: 100 });
        rollups.push(rollup);
        continue;
      }

      const { data: games } = await sb
        .from("games")
        .select("id, location_id, game_date, submitted_at, stats_completed, forfeit")
        .in("location_id", locationIds)
        .gte("game_date", fourteenAgo)
        .lte("game_date", ymd(snapshotDate));

      const eligible = ((games ?? []) as Array<{ game_date: string; submitted_at: string | null; stats_completed: boolean | null; forfeit: boolean | null }>)
        .filter((g) => !g.forfeit);
      const onTime = eligible.filter((g) => {
        if (!g.submitted_at || !g.stats_completed) return false;
        const gameEnd = new Date(g.game_date + "T23:59:00Z").getTime();
        return new Date(g.submitted_at).getTime() - gameEnd <= 86400000;
      });
      const pct = eligible.length ? Math.round((onTime.length / eligible.length) * 100) : 100;

      rollup.metrics.push({
        metric_slug: "stats_in_24h",
        raw_value: pct,
        max_score: 100,
        score: pct,
        payload: { window_days: 14, total: eligible.length, on_time: onTime.length },
      });

      const missing = eligible.length - onTime.length;
      if (pct < 85 && eligible.length > 0) {
        rollup.action_items.push({
          metric_slug: "stats_in_24h",
          title: `${missing} game${missing === 1 ? "" : "s"} missing stats within 24h SLA`,
          severity: pct < 60 ? "high" : "medium",
        });
      }
      rollups.push(rollup);
    }
    return { slug: "stats_health", rollups };
  },
};
