import type { Adapter, AdapterResult, LMRollup } from "../types";
import { sourceClient, sourceConfigured } from "../clients";
import { ymd, daysAgo } from "../util";

/**
 * brodie-content-health verified schema:
 *   profiles: id, email, full_name, role (lm|content_ops|dm|finance|admin), active
 *   user_locations: user_id, location_id
 *   content_nights: id, location_id, date, iphone_clips_posted_at,
 *                   photos_posted_at, videos_posted_at
 *
 * Sub-metric:
 *   content_in_48h (100%) — % of last 14d content_nights where videos_posted_at
 *                            is within 48h of the night's date.
 *                            (iPhone clips have 12h SLA, photos 3d, videos 4d
 *                             per the source schema comments, but we pick a
 *                             single signal for v1 — videos at 48h is mid-tier
 *                             ambition. Adjust by editing this file.)
 */
export const contentHealthAdapter: Adapter = {
  slug: "content_health",
  async sync(snapshotDate: Date): Promise<AdapterResult> {
    if (!sourceConfigured("content_health")) return { slug: "content_health", rollups: [], unconfigured: true };
    const sb = sourceClient("content_health")!;
    const fourteenAgo = ymd(daysAgo(snapshotDate, 14));

    const { data: profiles, error: pErr } = await sb
      .from("profiles")
      .select("id, email, full_name, role, active");
    if (pErr) return { slug: "content_health", rollups: [], error: pErr.message };
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
        rollup.metrics.push({ metric_slug: "content_in_48h", raw_value: 100, max_score: 100, score: 100 });
        rollups.push(rollup);
        continue;
      }

      const { data: nights } = await sb
        .from("content_nights")
        .select("id, location_id, date, videos_posted_at, photos_posted_at, iphone_clips_posted_at")
        .in("location_id", locationIds)
        .gte("date", fourteenAgo)
        .lte("date", ymd(snapshotDate));

      const eligible = (nights ?? []) as Array<{ date: string; videos_posted_at: string | null }>;
      const onTime = eligible.filter((n) => {
        if (!n.videos_posted_at) return false;
        const nightEnd = new Date(n.date + "T23:59:00Z").getTime();
        return new Date(n.videos_posted_at).getTime() - nightEnd <= 48 * 3600 * 1000;
      });
      const pct = eligible.length ? Math.round((onTime.length / eligible.length) * 100) : 100;

      rollup.metrics.push({
        metric_slug: "content_in_48h",
        raw_value: pct,
        max_score: 100,
        score: pct,
        payload: { window_days: 14, total: eligible.length, on_time: onTime.length },
      });

      const missing = eligible.length - onTime.length;
      if (pct < 80 && eligible.length > 0) {
        rollup.action_items.push({
          metric_slug: "content_in_48h",
          title: `${missing} content night${missing === 1 ? "" : "s"} missed the 48h video-post window`,
          severity: pct < 50 ? "high" : "medium",
        });
      }
      rollups.push(rollup);
    }
    return { slug: "content_health", rollups };
  },
};
