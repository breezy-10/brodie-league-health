import type { Adapter, AdapterResult, LMRollup } from "../types";
import { sourceClient, sourceConfigured } from "../clients";
import { ymd } from "../util";
import { addBusinessHours, businessDaysBetween } from "../business-days";
import { listLMsFromCRM, resolveLocationsForLM } from "../cross-app-locations";

/**
 * brodie-stats-health — task-based scoring (v2, locked 2026-05-27).
 *
 * Sub-metrics:
 *   stats_dispute_on_time (+10 each, awarded on the day of triage if within 48BH)
 *     dispute_submissions where triaged_at - received_at <= 48 business hours
 *     AND triaged_at falls on snapshot_date.
 *
 *   stats_dispute_overdue (-2 per open dispute per day, app floor -20)
 *     dispute_submissions where triaged_at IS NULL AND
 *     received_at + 48 BH < now.
 *
 * Triaging late (after 48BH) earns no XP but stops the daily drag.
 */
export const statsHealthAdapter: Adapter = {
  slug: "stats_health",
  async sync(snapshotDate: Date): Promise<AdapterResult> {
    if (!sourceConfigured("stats_health")) return { slug: "stats_health", rollups: [], unconfigured: true };
    const sb = sourceClient("stats_health")!;

    const todayStr = ymd(snapshotDate);
    const dayStart = `${todayStr}T00:00:00Z`;
    const dayEnd = `${todayStr}T23:59:59Z`;

    // Pull dispute_submissions. There are few of these so we just take them all
    // and filter per-LM by location_name.
    const { data: disputes } = await sb
      .from("dispute_submissions")
      .select("id, location_name, dispute_type, team_name, jersey_number, game_date, received_at, triaged_at");

    type Dispute = {
      id: string;
      location_name: string;
      dispute_type: string;
      team_name: string | null;
      jersey_number: string | null;
      game_date: string | null;
      received_at: string;
      triaged_at: string | null;
    };
    const allDisputes = (disputes ?? []) as Dispute[];

    // Map location_name → matched LMs via CRM.
    // Reverse lookup: for each dispute location_name, find which LMs in our
    // CRM list map to it via cross-app resolution. We do it by going LM-first
    // and resolving their location IDs, then we also pull the source app's
    // locations table to translate IDs → names.
    const { data: locations } = await sb.from("locations").select("id, name");
    const locNameById = new Map(
      ((locations ?? []) as Array<{ id: string; name: string }>).map((l) => [l.id, l.name])
    );

    const lms = await listLMsFromCRM();
    const rollups: LMRollup[] = [];

    for (const lm of lms) {
      const rollup: LMRollup = { lm_email: lm.email, metrics: [], action_items: [] };

      const myLocIds = await resolveLocationsForLM("stats_health", lm.email);
      const myLocNames = new Set(myLocIds.map((id) => locNameById.get(id)).filter((n): n is string => !!n));
      if (!myLocNames.size) {
        rollups.push(rollup);
        continue;
      }

      const myDisputes = allDisputes.filter((d) => myLocNames.has(d.location_name));

      let onTimeXp = 0;
      let onTimeCount = 0;
      const triaged_today_titles: string[] = [];

      let overdueXp = 0;
      let overdueCount = 0;

      for (const d of myDisputes) {
        const received = new Date(d.received_at);
        const deadline = addBusinessHours(received, 48);

        if (d.triaged_at) {
          // Was the triage in the on-time window AND on snapshot_date?
          const triaged = new Date(d.triaged_at);
          const triagedOnSnapshotDate = d.triaged_at >= dayStart && d.triaged_at <= dayEnd;
          if (triaged <= deadline && triagedOnSnapshotDate) {
            onTimeXp += 10;
            onTimeCount++;
            triaged_today_titles.push(
              `${d.team_name ?? "team"} #${d.jersey_number ?? "?"} (${d.dispute_type})`
            );
          }
          // Late triages: no XP, no penalty. Done.
        } else {
          // Still open. Penalize if past deadline.
          if (snapshotDate > deadline) {
            overdueXp -= 2;
            overdueCount++;
            const bdLate = businessDaysBetween(deadline, snapshotDate);
            rollup.action_items.push({
              metric_slug: "stats_dispute_overdue",
              title: `LATE: triage ${d.team_name ?? "dispute"} #${d.jersey_number ?? ""}`,
              detail: `${d.dispute_type} at ${d.location_name}, ${bdLate} business day${bdLate === 1 ? "" : "s"} late. -2 XP/day.`,
              severity: bdLate >= 3 ? "critical" : "high",
              source_ref: `stats_health://disputes/${d.id}`,
            });
          } else {
            // Open but still inside the 48 BH window — action item but no penalty yet.
            rollup.action_items.push({
              metric_slug: "stats_dispute_on_time",
              title: `Triage ${d.team_name ?? "dispute"} #${d.jersey_number ?? ""}`,
              detail: `${d.dispute_type} at ${d.location_name}. Triage within 48BH → +10 XP.`,
              severity: "medium",
              source_ref: `stats_health://disputes/${d.id}`,
            });
          }
        }
      }

      if (onTimeCount > 0) {
        rollup.action_items.push({
          metric_slug: "stats_dispute_on_time",
          title: `Triaged ${onTimeCount} dispute${onTimeCount === 1 ? "" : "s"} today`,
          detail: triaged_today_titles.slice(0, 3).join(", ") + (triaged_today_titles.length > 3 ? `, +${triaged_today_titles.length - 3} more` : "") + ` (+${onTimeXp} XP)`,
          severity: "low",
        });
      }

      rollup.metrics.push({
        metric_slug: "stats_dispute_on_time",
        raw_value: onTimeCount,
        max_score: myDisputes.length * 10,
        score: onTimeXp,
        payload: { triaged_on_time_today: onTimeCount, total_for_location: myDisputes.length },
      });
      rollup.metrics.push({
        metric_slug: "stats_dispute_overdue",
        raw_value: overdueCount,
        max_score: 0,
        score: overdueXp,
        payload: { overdue_open: overdueCount },
      });

      rollups.push(rollup);
    }

    return { slug: "stats_health", rollups };
  },
};
