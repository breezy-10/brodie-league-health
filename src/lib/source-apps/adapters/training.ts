import type { Adapter, AdapterResult, LMRollup } from "../types";
import { sourceClient, sourceConfigured } from "../clients";
import { ymd, daysAgo } from "../util";
import { listLMsFromCRM, resolveLocationsForLM } from "../cross-app-locations";

/**
 * brodie-training-pilot — task-based scoring (v2, locked 2026-05-27).
 *
 * Sub-metrics:
 *   training_staff_completion (+5 each)
 *     Per `completions.passed_at` row on snapshot_date for an active staff
 *     member at one of the LM's matched locations.
 *
 *   training_ghost_staff      (-2 per ghost staff per day, app floor -20)
 *     Active staff at the LM's matched location(s) who have NO completions
 *     in the last 30 days. "Disengaged" signal.
 */
export const trainingAdapter: Adapter = {
  slug: "training",
  async sync(snapshotDate: Date): Promise<AdapterResult> {
    if (!sourceConfigured("training")) return { slug: "training", rollups: [], unconfigured: true };
    const sb = sourceClient("training")!;

    const todayStr = ymd(snapshotDate);
    const dayStart = `${todayStr}T00:00:00Z`;
    const dayEnd = `${todayStr}T23:59:59Z`;
    const thirtyDaysAgo = ymd(daysAgo(snapshotDate, 30));
    const thirtyDaysAgoIso = `${thirtyDaysAgo}T00:00:00Z`;

    // Active staff per location
    const { data: users, error: uErr } = await sb
      .from("users")
      .select("id, location_id, status, full_name");
    if (uErr) return { slug: "training", rollups: [], error: uErr.message };

    type StaffRow = { id: string; location_id: string | null; status: string; full_name: string | null };
    const staffByLoc = new Map<string, StaffRow[]>();
    for (const u of (users ?? []) as StaffRow[]) {
      if (u.status !== "active" || !u.location_id) continue;
      const arr = staffByLoc.get(u.location_id) ?? [];
      arr.push(u);
      staffByLoc.set(u.location_id, arr);
    }

    // Completions today (single fetch, then map by user)
    const { data: completionsToday } = await sb
      .from("completions")
      .select("user_id, module_id, passed_at")
      .gte("passed_at", dayStart)
      .lte("passed_at", dayEnd);

    const completionsByUserToday = new Map<string, number>();
    for (const c of (completionsToday ?? []) as Array<{ user_id: string }>) {
      completionsByUserToday.set(c.user_id, (completionsByUserToday.get(c.user_id) ?? 0) + 1);
    }

    // Most recent completion per user in the last 30 days (to detect ghosts)
    const { data: recentCompletions } = await sb
      .from("completions")
      .select("user_id, passed_at")
      .gte("passed_at", thirtyDaysAgoIso);
    const recentlyActive = new Set((recentCompletions ?? []).map((r: { user_id: string }) => r.user_id));

    const lms = await listLMsFromCRM();
    const rollups: LMRollup[] = [];

    for (const lm of lms) {
      const locationIds = await resolveLocationsForLM("training", lm.email);
      const rollup: LMRollup = { lm_email: lm.email, metrics: [], action_items: [] };

      if (!locationIds.length) {
        rollups.push(rollup);
        continue;
      }

      const staff: StaffRow[] = [];
      for (const lid of locationIds) {
        for (const s of staffByLoc.get(lid) ?? []) staff.push(s);
      }
      // Dedup in case a staff member shows up across matched locations
      const seen = new Set<string>();
      const uniqueStaff = staff.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));

      let completionsCount = 0;
      const completedNames: string[] = [];
      for (const s of uniqueStaff) {
        const n = completionsByUserToday.get(s.id) ?? 0;
        if (n > 0) {
          completionsCount += n;
          completedNames.push((s.full_name ?? "Someone") + (n > 1 ? ` ×${n}` : ""));
        }
      }
      const completionXp = completionsCount * 5;

      const ghosts = uniqueStaff.filter((s) => !recentlyActive.has(s.id));
      const ghostXp = ghosts.length * -2;

      rollup.metrics.push({
        metric_slug: "training_staff_completion",
        raw_value: completionsCount,
        max_score: uniqueStaff.length * 5,
        score: completionXp,
        payload: { staff: uniqueStaff.length, completions_today: completionsCount },
      });
      rollup.metrics.push({
        metric_slug: "training_ghost_staff",
        raw_value: ghosts.length,
        max_score: 0,
        score: ghostXp,
        payload: { staff: uniqueStaff.length, ghosts: ghosts.length },
      });

      // Action items — positive (celebrate) and negative (nudge)
      if (completionsCount > 0) {
        rollup.action_items.push({
          metric_slug: "training_staff_completion",
          title: `${completionsCount} staff completed training`,
          detail: completedNames.slice(0, 5).join(", ") + (completedNames.length > 5 ? `, +${completedNames.length - 5} more` : "") + ` (+${completionXp} XP)`,
          severity: "low",
        });
      }
      if (ghosts.length > 0) {
        const sample = ghosts.slice(0, 3).map((g) => g.full_name ?? "(unknown)").join(", ");
        rollup.action_items.push({
          metric_slug: "training_ghost_staff",
          title: `Nudge ${ghosts.length} ghost staff`,
          detail: `No completions in 30+ days: ${sample}${ghosts.length > 3 ? `, +${ghosts.length - 3} more` : ""}. -${Math.abs(ghostXp)} XP/day.`,
          severity: ghosts.length > 5 ? "high" : "medium",
        });
      }

      rollups.push(rollup);
    }
    return { slug: "training", rollups };
  },
};
