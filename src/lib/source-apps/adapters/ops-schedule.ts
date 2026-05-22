import type { Adapter, AdapterResult, LMRollup } from "../types";
import { sourceClient, sourceConfigured } from "../clients";
import { ymd, daysAhead, daysAgo } from "../util";

/**
 * brodie-ops-schedule verified schema:
 *   users: id, email, full_name, primary_role_id, home_district_id, home_location_id, status
 *   roles: id, name (e.g. 'lm', 'league_manager')
 *   shifts: id, location_id, manager_id, role_id, shift_date, required_count, status
 *   shift_assignments: id, shift_id, user_id, state ('assigned','confirmed','released',
 *                       'swapped_out','called_out','completed'), released_at
 *
 * LM-shift link: shifts.manager_id IS the LM.
 *
 * Sub-metrics:
 *   shifts_7d_out (70%) — for shifts in the next 7 days where manager_id = LM:
 *                          % whose count(active assignments) >= required_count
 *   drop_rate     (30%) — count of shift_assignments transitioning to
 *                          'released' or 'called_out' in the past 14 days
 *                          for the LM's shifts (lower better)
 */
export const opsScheduleAdapter: Adapter = {
  slug: "ops_schedule",
  async sync(snapshotDate: Date): Promise<AdapterResult> {
    if (!sourceConfigured("ops_schedule")) return { slug: "ops_schedule", rollups: [], unconfigured: true };
    const sb = sourceClient("ops_schedule")!;
    const today = ymd(snapshotDate);
    const sevenAhead = ymd(daysAhead(snapshotDate, 7));
    const fourteenAgo = ymd(daysAgo(snapshotDate, 14));

    const { data: roles } = await sb.from("roles").select("id, name");
    const lmRoleIds = new Set(
      (roles ?? [])
        .filter((r: { name?: string }) => {
          const tag = (r.name ?? "").toLowerCase();
          return tag === "lm" || tag === "league_manager" || tag === "dm" || tag === "district_manager";
        })
        .map((r: { id: string }) => r.id)
    );

    const { data: users, error: uErr } = await sb
      .from("users")
      .select("id, email, full_name, primary_role_id, status");
    if (uErr) return { slug: "ops_schedule", rollups: [], error: uErr.message };

    const lms = (users ?? []).filter(
      (u: { primary_role_id: string | null; status: string }) =>
        u.status === "active" && u.primary_role_id && lmRoleIds.has(u.primary_role_id)
    ) as Array<{ id: string; email: string }>;

    const rollups: LMRollup[] = [];

    for (const lm of lms) {
      const rollup: LMRollup = { lm_email: lm.email, metrics: [], action_items: [] };

      // upcoming shifts
      const { data: upcoming } = await sb
        .from("shifts")
        .select("id, shift_date, required_count, status")
        .eq("manager_id", lm.id)
        .gte("shift_date", today)
        .lte("shift_date", sevenAhead)
        .in("status", ["scheduled", "open"]);

      const upShifts = (upcoming ?? []) as Array<{ id: string; required_count: number; status: string }>;
      const upIds = upShifts.map((s) => s.id);

      let unfilled = 0;
      if (upIds.length) {
        const { data: assigns } = await sb
          .from("shift_assignments")
          .select("shift_id, state")
          .in("shift_id", upIds)
          .in("state", ["assigned", "confirmed"]);
        const fillCount = new Map<string, number>();
        for (const a of (assigns ?? []) as Array<{ shift_id: string }>) {
          fillCount.set(a.shift_id, (fillCount.get(a.shift_id) ?? 0) + 1);
        }
        for (const s of upShifts) {
          if ((fillCount.get(s.id) ?? 0) < (s.required_count ?? 1)) unfilled++;
        }
      }

      const totalShifts = upShifts.length;
      const filledCount = totalShifts - unfilled;
      const fillPct = totalShifts ? Math.round((filledCount / totalShifts) * 100) : 100;

      rollup.metrics.push({
        metric_slug: "shifts_7d_out",
        raw_value: fillPct,
        max_score: 100,
        score: fillPct,
        payload: { total: totalShifts, unfilled },
      });
      if (fillPct < 90 && totalShifts > 0) {
        rollup.action_items.push({
          metric_slug: "shifts_7d_out",
          title: `${unfilled} unfilled shift${unfilled === 1 ? "" : "s"} in the next 7 days`,
          severity: fillPct < 70 ? "high" : "medium",
        });
      }

      // drops: any shift_assignments on LM's shifts that went released/called_out in last 14d
      const { data: lmShifts } = await sb
        .from("shifts")
        .select("id")
        .eq("manager_id", lm.id)
        .gte("shift_date", fourteenAgo);
      const lmShiftIds = (lmShifts ?? []).map((s: { id: string }) => s.id);
      let drops = 0;
      if (lmShiftIds.length) {
        const { count } = await sb
          .from("shift_assignments")
          .select("*", { count: "exact", head: true })
          .in("shift_id", lmShiftIds)
          .in("state", ["released", "called_out"])
          .gte("released_at", fourteenAgo);
        drops = count ?? 0;
      }
      const dropScore = Math.max(0, 100 - drops * 10);
      rollup.metrics.push({
        metric_slug: "drop_rate",
        raw_value: drops,
        max_score: 100,
        score: dropScore,
        payload: { window_days: 14, drops },
      });
      if (drops >= 3) {
        rollup.action_items.push({
          metric_slug: "drop_rate",
          title: `${drops} last-minute drops on your shifts the past 2 weeks`,
          severity: "medium",
        });
      }
      rollups.push(rollup);
    }
    return { slug: "ops_schedule", rollups };
  },
};
