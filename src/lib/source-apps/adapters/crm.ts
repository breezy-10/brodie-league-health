import type { Adapter, AdapterResult, LMRollup } from "../types";
import { sourceClient, sourceConfigured } from "../clients";
import { ymd } from "../util";

/**
 * brodie-crm — task-based scoring (v2, locked 2026-05-27).
 *
 * Three sub-metrics:
 *   crm_touch         (+1 each, max 50/day counted)
 *     Any activities row OR completed cadence_event that the LM initiated
 *     today. Excludes customer.io system activities (source='cio') and
 *     mass-broadcast webhooks (source='broadcast_webhook') since those
 *     aren't manual outreach.
 *
 *   crm_50_bonus      (+10 if touch count >= 50)
 *     One-time bonus per day.
 *
 *   crm_ig_no_outcome (-0.5 each, floored at -15)
 *     Outbound IG DMs (activities, channel='ig', direction='outbound',
 *     manager_id=LM) that are more than 24h old and still have
 *     outcome IS NULL. Penalty for "I sent it and never logged what
 *     happened."
 *
 * Live counter (not XP): current-season registered/full teams in their
 * assigned locations. The dashboard pulls this directly — adapter just
 * surfaces it on the rollup so admin pages can also see it.
 */

// Excludes anything system-generated. Customer.io uses both `cio` and
// `cio_webhook`. Broadcast webhooks are mass-blast outputs (not personal).
const NON_LM_SOURCES = ["cio", "cio_webhook", "broadcast_webhook"];

export const crmAdapter: Adapter = {
  slug: "crm",
  async sync(snapshotDate: Date): Promise<AdapterResult> {
    if (!sourceConfigured("crm")) return { slug: "crm", rollups: [], unconfigured: true };
    const sb = sourceClient("crm")!;

    const todayStr = ymd(snapshotDate);
    const dayStart = todayStr + "T00:00:00Z";
    const dayEnd = todayStr + "T23:59:59Z";
    const cutoff24h = new Date(snapshotDate.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const { data: managers, error: mErr } = await sb
      .from("managers")
      .select("id, email, role, active");
    if (mErr) return { slug: "crm", rollups: [], error: mErr.message };

    const lms = (managers ?? []).filter(
      (m: { role: string; active: boolean }) =>
        (m.role === "league_manager" || m.role === "district_manager") && m.active
    ) as Array<{ id: string; email: string }>;

    const rollups: LMRollup[] = [];

    for (const m of lms) {
      const rollup: LMRollup = {
        lm_email: m.email,
        metrics: [],
        action_items: [],
      };

      // 1. crm_touch — count today's LM-initiated touches with anti-gaming
      // guards. Must be:
      //   - direction=outbound (not inbound replies or system events)
      //   - source not in (cio, cio_webhook, broadcast_webhook)
      //   - For channels that should have content (ig, text, email),
      //     body must be non-empty (no blank-row spam)
      //   - Per (lead_id, channel) per day: capped at 3 — working a lead
      //     deeply still counts, but spamming 50 IG DMs at one lead
      //     doesn't inflate the score
      const { data: actsToday } = await sb
        .from("activities")
        .select("id, lead_id, source, channel, direction, body")
        .eq("manager_id", m.id)
        .eq("direction", "outbound")
        .gte("created_at", dayStart)
        .lte("created_at", dayEnd);

      const REQUIRES_BODY = new Set(["ig", "text", "email"]);
      const PER_LEAD_DAILY_CAP = 3;

      type Act = { id: string; lead_id: string | null; source: string | null; channel: string | null; body: string | null };
      const validActs = ((actsToday ?? []) as Act[]).filter((a) => {
        if (NON_LM_SOURCES.includes(a.source ?? "")) return false;
        if (REQUIRES_BODY.has(a.channel ?? "") && !(a.body ?? "").trim()) return false;
        return true;
      });
      // Apply per-(lead, channel) daily cap
      const perLeadChannelCount = new Map<string, number>();
      let activityTouches = 0;
      for (const a of validActs) {
        const key = `${a.lead_id ?? "none"}:${a.channel ?? "none"}`;
        const seen = perLeadChannelCount.get(key) ?? 0;
        if (seen < PER_LEAD_DAILY_CAP) {
          activityTouches++;
          perLeadChannelCount.set(key, seen + 1);
        }
      }

      const { data: cadenceToday } = await sb
        .from("cadence_events")
        .select("id, completed_by, status, completed_at")
        .eq("completed_by", m.id)
        .eq("status", "completed")
        .gte("completed_at", dayStart)
        .lte("completed_at", dayEnd);
      const cadenceTouches = (cadenceToday ?? []).length;

      const totalTouches = activityTouches + cadenceTouches;
      // 1 XP per touch, but cap the *base count* at 50 (so XP from touches ≤ 50)
      const touchXp = Math.min(totalTouches, 50);

      rollup.metrics.push({
        metric_slug: "crm_touch",
        raw_value: totalTouches,
        max_score: 50,
        score: touchXp,
        payload: { total: totalTouches, capped_at_50: totalTouches > 50, activities: activityTouches, cadence: cadenceTouches },
      });

      // 2. crm_50_bonus — +10 if hit 50 touches today
      const hit50 = totalTouches >= 50;
      rollup.metrics.push({
        metric_slug: "crm_50_bonus",
        raw_value: hit50 ? 1 : 0,
        max_score: 10,
        score: hit50 ? 10 : 0,
        payload: { hit_threshold: hit50, threshold: 50 },
      });

      // 3. crm_ig_no_outcome — outbound IG DMs >24h old with outcome IS NULL
      const { data: ghosted } = await sb
        .from("activities")
        .select("id, created_at, body")
        .eq("manager_id", m.id)
        .eq("channel", "ig")
        .eq("direction", "outbound")
        .is("outcome", null)
        .lt("created_at", cutoff24h);
      const ghostCount = (ghosted ?? []).length;
      const ghostXp = Math.max(-15, -0.5 * ghostCount);

      rollup.metrics.push({
        metric_slug: "crm_ig_no_outcome",
        raw_value: ghostCount,
        max_score: 0,
        score: ghostXp,
        payload: { ghosted: ghostCount, floor_hit: ghostXp === -15 },
      });

      // ---- Action items: only what the LM can actually action today ----
      const remaining = Math.max(0, 50 - totalTouches);
      if (remaining > 0) {
        rollup.action_items.push({
          metric_slug: "crm_touch",
          title: `Make ${remaining} more touch${remaining === 1 ? "" : "es"}`,
          detail: `${totalTouches}/50 done so far. Each touch = +1 XP, plus +10 bonus at 50.`,
          severity: remaining > 30 ? "high" : remaining > 10 ? "medium" : "low",
        });
      }
      if (ghostCount > 0) {
        rollup.action_items.push({
          metric_slug: "crm_ig_no_outcome",
          title: `Log ${ghostCount} IG DM outcome${ghostCount === 1 ? "" : "s"}`,
          detail: `Each one is costing you 0.5 XP/day. Log the outcome to stop the bleed.`,
          severity: ghostCount >= 10 ? "high" : "medium",
        });
      }

      rollups.push(rollup);
    }

    return { slug: "crm", rollups };
  },
};
