import type { Adapter, AdapterResult, LMRollup } from "../types";
import { sourceClient, sourceConfigured } from "../clients";
import { ymd } from "../util";
import { listLMsFromCRM, resolveLocationsForLM } from "../cross-app-locations";

/**
 * brodie-seasonal-checklist — locked 2026-05-27.
 *
 * Scope by LOCATION: each season_task → seasons.location_id → locations.name.
 * Match those names against the LM's CRM-assigned location names (fuzzy).
 *
 * Sub-metrics:
 *   checklist_progress  +5 XP per task that flipped to 'in_progress' or
 *                          'done' today (status_changed_at on snapshot_date).
 *   checklist_overdue   -1 XP/day per task with due_date < today AND
 *                          status = 'not_started'. App xp_floor caps.
 */
export const checklistAdapter: Adapter = {
  slug: "checklist",
  async sync(snapshotDate: Date): Promise<AdapterResult> {
    if (!sourceConfigured("checklist")) return { slug: "checklist", rollups: [], unconfigured: true };
    const sb = sourceClient("checklist")!;

    const todayStr = ymd(snapshotDate);
    const dayStart = `${todayStr}T00:00:00Z`;
    const dayEnd = `${todayStr}T23:59:59Z`;

    // Pull all non-archived seasons + their location_id once.
    const { data: seasons } = await sb
      .from("seasons")
      .select("id, location_id, name, archived")
      .eq("archived", false);
    type Season = { id: string; location_id: string; name: string };
    const seasonList = (seasons ?? []) as Season[];
    const seasonsByLocation = new Map<string, Season[]>();
    for (const s of seasonList) {
      const arr = seasonsByLocation.get(s.location_id) ?? [];
      arr.push(s);
      seasonsByLocation.set(s.location_id, arr);
    }

    const lms = await listLMsFromCRM();
    const rollups: LMRollup[] = [];

    for (const lm of lms) {
      const locationIds = await resolveLocationsForLM("checklist", lm.email);
      const rollup: LMRollup = { lm_email: lm.email, metrics: [], action_items: [] };

      if (!locationIds.length) {
        rollups.push(rollup);
        continue;
      }

      // Find seasons at these locations
      const relevantSeasonIds: string[] = [];
      for (const lid of locationIds) {
        for (const s of seasonsByLocation.get(lid) ?? []) relevantSeasonIds.push(s.id);
      }
      if (!relevantSeasonIds.length) {
        rollups.push(rollup);
        continue;
      }

      // Pull season_tasks for these seasons
      const { data: tasks } = await sb
        .from("season_tasks")
        .select("id, season_id, title, status, status_changed_at, due_date, phase")
        .in("season_id", relevantSeasonIds);

      type Task = {
        id: string;
        season_id: string;
        title: string;
        status: string;
        status_changed_at: string | null;
        due_date: string | null;
        phase: string | null;
      };
      const taskList = (tasks ?? []) as Task[];

      // ----- Progress XP: tasks flipped to in_progress/done today -----
      const flippedToday = taskList.filter(
        (t) =>
          (t.status === "in_progress" || t.status === "done") &&
          t.status_changed_at &&
          t.status_changed_at >= dayStart &&
          t.status_changed_at <= dayEnd
      );
      const progressXp = flippedToday.length * 5;

      // ----- Overdue penalty -----
      const overdueTasks = taskList.filter(
        (t) => t.status === "not_started" && t.due_date && t.due_date < todayStr
      );
      const overdueXp = overdueTasks.length * -1;

      // ----- Action items -----
      if (flippedToday.length > 0) {
        const titles = flippedToday.slice(0, 5).map((t) => `${t.title}${t.status === "done" ? " ✓" : " (in progress)"}`);
        rollup.action_items.push({
          metric_slug: "checklist_progress",
          title: `Moved ${flippedToday.length} checklist task${flippedToday.length === 1 ? "" : "s"}`,
          detail: titles.join(", ") + (flippedToday.length > 5 ? `, +${flippedToday.length - 5} more` : "") + ` (+${progressXp} XP)`,
          severity: "low",
        });
      }
      const sortedOverdue = [...overdueTasks].sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));
      for (const t of sortedOverdue.slice(0, 5)) {
        rollup.action_items.push({
          metric_slug: "checklist_overdue",
          title: t.title,
          detail: `Due ${t.due_date}${t.phase ? ` (${t.phase})` : ""}. -1 XP/day until done.`,
          severity: "medium",
          source_ref: `checklist://tasks/${t.id}`,
        });
      }
      if (overdueTasks.length > 5) {
        rollup.action_items.push({
          metric_slug: "checklist_overdue",
          title: `+${overdueTasks.length - 5} more overdue`,
          severity: "medium",
        });
      }

      rollup.metrics.push({
        metric_slug: "checklist_progress",
        raw_value: flippedToday.length,
        max_score: taskList.length * 5,
        score: progressXp,
        payload: { flipped_today: flippedToday.length, total_tasks: taskList.length },
      });
      rollup.metrics.push({
        metric_slug: "checklist_overdue",
        raw_value: overdueTasks.length,
        max_score: 0,
        score: overdueXp,
        payload: { overdue: overdueTasks.length },
      });

      rollups.push(rollup);
    }

    return { slug: "checklist", rollups };
  },
};
