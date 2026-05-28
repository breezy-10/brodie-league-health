import type { Adapter, AdapterResult, LMRollup } from "../types";
import { sourceClient, sourceConfigured } from "../clients";
import { ymd, daysAgo } from "../util";
import { isWeekend } from "../business-days";
import { listLMsFromCRM, resolveLocationsForLM } from "../cross-app-locations";

/**
 * brodie-ref-payroll — deadline-driven scoring (v2, locked 2026-05-27).
 *
 * Pay periods are Sat→Fri. The deadline to have both submitted AND approved
 * is the Monday after pay_period_end at 12:00 PM America/New_York.
 *
 * Scoring per submission (per LM, per LM's locations):
 *   ref_payroll_on_time   +15 ONCE, awarded on the deadline day if both
 *                              submitted_at AND dm_decided_at are < deadline
 *   ref_payroll_late_hit  -15 ONCE, applied on the deadline day if at deadline
 *                              time either field is null
 *   ref_payroll_drag      -3 each weekday after the deadline while either
 *                              field is still null (stops once both set)
 *
 * Per-app xp_floor (-20 default) caps the negative side across these three.
 */

const ET_TZ = "America/New_York";

function hourInTZ(d: Date, tz: string): number {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false });
  return parseInt(f.format(d), 10);
}
function dowInTZ(d: Date, tz: string): number {
  // 0 = Sunday, 1 = Monday, etc.
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" });
  const s = f.format(d);
  return ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[s];
}
function dateInTZ(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Most recent Friday on or before `d` (in ET). */
function mostRecentFridayET(d: Date): Date {
  const dow = dowInTZ(d, ET_TZ);
  // distance back to Friday (5)
  const back = (dow - 5 + 7) % 7; // if today is Fri, back=0
  const result = new Date(d);
  result.setUTCDate(result.getUTCDate() - back);
  return result;
}

/** Build a Date that represents 12:00 noon ET on the given calendar date in ET. */
function noonETOnDate(etDateStr: string): Date {
  // etDateStr is YYYY-MM-DD in ET. Brute-force: try noon UTC, then shift.
  // The TZ offset for ET is -4 (DST) or -5. We try both and pick the one whose
  // ET hour rendering = 12.
  for (const offset of [4, 5]) {
    const d = new Date(`${etDateStr}T${String(12 + offset).padStart(2, "0")}:00:00Z`);
    if (hourInTZ(d, ET_TZ) === 12 && dateInTZ(d, ET_TZ) === etDateStr) return d;
  }
  // Fallback (shouldn't hit): 16:00 UTC ≈ noon EDT.
  return new Date(`${etDateStr}T16:00:00Z`);
}

/** Monday after the given Friday (returns the ET calendar date YYYY-MM-DD). */
function mondayAfterFridayET(fridayUTC: Date): string {
  const d = new Date(fridayUTC);
  d.setUTCDate(d.getUTCDate() + 3);
  return dateInTZ(d, ET_TZ);
}

/** Count weekdays (Mon-Fri ET) strictly after `fromET` and through `toUTC`. */
function weekdaysSinceET(fromETDateStr: string, toUTC: Date): number {
  const start = new Date(`${fromETDateStr}T16:00:00Z`); // approx noon ET
  if (toUTC <= start) return 0;
  let count = 0;
  const cursor = new Date(start);
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  while (cursor <= toUTC) {
    if (!isWeekend(cursor)) count++;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

export const refPayrollAdapter: Adapter = {
  slug: "ref_payroll",
  async sync(snapshotDate: Date): Promise<AdapterResult> {
    if (!sourceConfigured("ref_payroll")) return { slug: "ref_payroll", rollups: [], unconfigured: true };
    const sb = sourceClient("ref_payroll")!;

    const todayUTC = snapshotDate;
    const todayET = dateInTZ(todayUTC, ET_TZ);
    const todayDow = dowInTZ(todayUTC, ET_TZ);
    const todayHourET = hourInTZ(todayUTC, ET_TZ);

    // Pay periods to evaluate: last 4 weeks of Friday-endings prior to today.
    // (Most recent Friday strictly before today, going back 4 weeks.)
    const friCutoff = mostRecentFridayET(todayUTC);
    const periods: Array<{ pay_period_end: string }> = [];
    for (let i = 0; i < 4; i++) {
      const d = new Date(friCutoff);
      d.setUTCDate(d.getUTCDate() - 7 * i);
      // skip the current week if today is before Friday (period hasn't closed)
      if (dateInTZ(d, ET_TZ) >= todayET && i === 0) continue;
      periods.push({ pay_period_end: dateInTZ(d, ET_TZ) });
    }
    if (!periods.length) return { slug: "ref_payroll", rollups: [] };

    const fourteenAgo = ymd(daysAgo(snapshotDate, 28));

    const lms = await listLMsFromCRM();
    const rollups: LMRollup[] = [];

    for (const lm of lms) {
      const rollup: LMRollup = { lm_email: lm.email, metrics: [], action_items: [] };

      const locationIds = await resolveLocationsForLM("ref_payroll", lm.email);

      if (!locationIds.length) {
        // Emit zero-snapshots so the adapter has consistent presence.
        rollup.metrics.push({ metric_slug: "ref_payroll_on_time",  raw_value: 0, max_score: 0, score: 0 });
        rollup.metrics.push({ metric_slug: "ref_payroll_late_hit", raw_value: 0, max_score: 0, score: 0 });
        rollup.metrics.push({ metric_slug: "ref_payroll_drag",     raw_value: 0, max_score: 0, score: 0 });
        rollups.push(rollup);
        continue;
      }

      // pull all submissions for these locations in the relevant window.
      const periodEnds = periods.map((p) => p.pay_period_end);
      const { data: subs } = await sb
        .from("submissions")
        .select("id, location_id, pay_period_start, pay_period_end, submitted_at, dm_decided_at, status")
        .in("location_id", locationIds)
        .gte("pay_period_start", fourteenAgo);

      type Sub = {
        id: string; location_id: string;
        pay_period_start: string; pay_period_end: string;
        submitted_at: string | null; dm_decided_at: string | null;
      };
      const subList = (subs ?? []) as Sub[];

      let onTimeXp = 0;
      let lateHitXp = 0;
      let dragXp = 0;

      let onTimeCount = 0;
      let lateHitCount = 0;
      let dragSubmissions = 0;

      // For each location, ensure we have a row (virtual or real) per period
      for (const locId of locationIds) {
        for (const periodEnd of periodEnds) {
          const deadlineDateET = mondayAfterFridayET(new Date(`${periodEnd}T00:00:00Z`));
          const deadlineUTC = noonETOnDate(deadlineDateET);
          const sub = subList.find((s) => s.location_id === locId && s.pay_period_end === periodEnd);

          // Has the deadline passed (in ET) yet?
          const todayPastDeadline =
            todayET > deadlineDateET ||
            (todayET === deadlineDateET && todayHourET >= 12);

          const submittedInTime = !!sub?.submitted_at && new Date(sub.submitted_at) < deadlineUTC;
          const approvedInTime  = !!sub?.dm_decided_at && new Date(sub.dm_decided_at) < deadlineUTC;
          const bothInTime = submittedInTime && approvedInTime;
          const eitherStillNull = !sub?.submitted_at || !sub?.dm_decided_at;

          if (todayET === deadlineDateET && todayHourET >= 12) {
            // Deadline day, past noon ET. Score the one-time outcomes today.
            if (bothInTime) { onTimeXp += 15; onTimeCount++; }
            else            { lateHitXp -= 15; lateHitCount++; }
          }

          if (todayPastDeadline && todayET !== deadlineDateET && eitherStillNull) {
            // It's a weekday after deadline and the submission is still unsettled.
            if (!isWeekend(todayUTC)) {
              dragXp -= 3;
              dragSubmissions++;
            }
          }

          // ----- Action items -----
          // Monday 6am-noon ET on the deadline day, and still unsettled.
          if (todayET === deadlineDateET && todayHourET < 12 && eitherStillNull) {
            rollup.action_items.push({
              metric_slug: "ref_payroll_on_time",
              title: `Submit + approve payroll`,
              detail: `Period ending ${periodEnd}. Both done by 12pm ET → +15 XP.`,
              severity: "high",
              source_ref: `ref_payroll://submissions?location=${locId}&period=${periodEnd}`,
            });
          }
          // After Monday noon and still unsettled — flip to critical
          if (todayPastDeadline && eitherStillNull) {
            const days = weekdaysSinceET(deadlineDateET, todayUTC);
            const cost = 15 + days * 3;
            rollup.action_items.push({
              metric_slug: "ref_payroll_drag",
              title: `LATE: payroll ${periodEnd}`,
              detail: `${days} weekday${days === 1 ? "" : "s"} past deadline. Already cost ${cost} XP. -3/day until done.`,
              severity: "critical",
              source_ref: `ref_payroll://submissions?location=${locId}&period=${periodEnd}`,
            });
          }
        }
      }

      rollup.metrics.push({
        metric_slug: "ref_payroll_on_time",
        raw_value: onTimeCount,
        max_score: 15 * (periodEnds.length * locationIds.length),
        score: onTimeXp,
        payload: { on_time_today: onTimeCount },
      });
      rollup.metrics.push({
        metric_slug: "ref_payroll_late_hit",
        raw_value: lateHitCount,
        max_score: 0,
        score: lateHitXp,
        payload: { late_today: lateHitCount },
      });
      rollup.metrics.push({
        metric_slug: "ref_payroll_drag",
        raw_value: dragSubmissions,
        max_score: 0,
        score: dragXp,
        payload: { dragging_submissions: dragSubmissions },
      });

      rollups.push(rollup);
    }

    return { slug: "ref_payroll", rollups };
  },
};
