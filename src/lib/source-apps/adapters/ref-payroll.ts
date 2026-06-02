import type { Adapter, AdapterResult, LMRollup } from "../types";
import { sourceClient, sourceConfigured } from "../clients";
import { listLMsFromCRM, resolveLocationsForLM } from "../cross-app-locations";

/**
 * brodie-ref-payroll — bounded-deadline scoring (v3, locked 2026-05-29).
 *
 * THE PROBLEM WE'RE FIXING: v2 kept deducting -3/day forever for missed
 * payrolls, even weeks later. An LM can't go back and fix a 3-week-old
 * payroll, so the penalty just nagged them indefinitely.
 *
 * NEW MODEL: rewards finishing early, penalties graduated within the
 * deadline day only, then the period LOCKS at -15 and stops nagging.
 *
 * Pay periods end Friday. Deadline = following Monday 12:00 PM ET.
 *
 * Scoring (one-time, applied on the snapshot for deadline_date+1 onwards
 * for 7 days, then drops off):
 *   submitted+approved by Sunday 23:59 ET     → +15  (early reward)
 *   submitted+approved by Monday 12:00 PM ET  →  +5  (on-time)
 *   submitted+approved by Monday 18:00 ET     →  -5  (late AM penalty)
 *   submitted+approved by Monday 23:59 ET     →  -10 (late PM penalty)
 *   NOT done by Tuesday 00:00 ET              →  -15 (LOCKED, no further hits)
 *
 * Action items only show when the period is still actionable
 * (Saturday → Monday EOD). After Tuesday morning, no action item, no
 * recurring deduction, the period drops out of scoring after 7 days.
 */

const ET_TZ = "America/New_York";

function hourInTZ(d: Date, tz: string): number {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false });
  return parseInt(f.format(d), 10);
}
function dowInTZ(d: Date, tz: string): number {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" });
  const s = f.format(d);
  return ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[s];
}
function dateInTZ(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Build a UTC Date for HH:00 ET on a given ET calendar date. */
function hourETOnDate(etDateStr: string, hourET: number): Date {
  // ET is UTC-4 (DST) or UTC-5. Start from midnight UTC on the ET date,
  // then add (hourET + offset) hours. JS Date handles the day rollover when
  // hourET+offset >= 24 (which crashed the old string-concat version with
  // "Invalid time value" for hourET=23).
  for (const offset of [4, 5]) {
    const base = new Date(`${etDateStr}T00:00:00Z`).getTime();
    const d = new Date(base + (hourET + offset) * 60 * 60 * 1000);
    if (hourInTZ(d, ET_TZ) === hourET && dateInTZ(d, ET_TZ) === etDateStr) return d;
  }
  // Fallback if neither offset matches (shouldn't happen for real ET dates).
  const base = new Date(`${etDateStr}T00:00:00Z`).getTime();
  return new Date(base + (hourET + 4) * 60 * 60 * 1000);
}

/** Friday of the pay period for which deadline is the given Monday. */
function fridayBeforeMondayET(mondayETDateStr: string): string {
  const monday = new Date(`${mondayETDateStr}T16:00:00Z`); // noon ET-ish
  monday.setUTCDate(monday.getUTCDate() - 3);
  return dateInTZ(monday, ET_TZ);
}

/** Monday on or before `d` (going backward up to 6 days). Returns ET date string. */
function mondayOnOrBeforeET(d: Date): string {
  const dow = dowInTZ(d, ET_TZ);
  const back = (dow - 1 + 7) % 7; // dow=1 (Mon) → 0
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() - back);
  return dateInTZ(out, ET_TZ);
}

/** Days between two ET date strings (a → b). Positive if b > a. */
function daysBetweenET(aETDateStr: string, bETDateStr: string): number {
  const a = new Date(`${aETDateStr}T12:00:00Z`);
  const b = new Date(`${bETDateStr}T12:00:00Z`);
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

type SettlementBand = "early" | "on_time" | "late_am" | "late_pm" | "missed";

/** Pick the band based on the submission/approval timestamps + deadline. */
function classifySettlement(
  sub: { submitted_at: string | null; dm_decided_at: string | null } | undefined,
  mondayDateET: string
): SettlementBand {
  if (!sub?.submitted_at || !sub?.dm_decided_at) return "missed";
  const settledAt = new Date(
    Math.max(new Date(sub.submitted_at).getTime(), new Date(sub.dm_decided_at).getTime())
  );
  const sundayEOD = hourETOnDate(
    dateInTZ(new Date(new Date(`${mondayDateET}T16:00:00Z`).getTime() - 24 * 60 * 60 * 1000), ET_TZ),
    23
  ); // 11pm Sunday ≈ "by end of Sunday"
  const sundayMidnight = new Date(sundayEOD.getTime() + 60 * 60 * 1000); // 00:00 ET Mon
  const mondayNoon = hourETOnDate(mondayDateET, 12);
  const monday6pm = hourETOnDate(mondayDateET, 18);
  const tuesday0am = new Date(
    hourETOnDate(mondayDateET, 0).getTime() + 24 * 60 * 60 * 1000
  );
  if (settledAt < sundayMidnight) return "early";
  if (settledAt < mondayNoon) return "on_time";
  if (settledAt < monday6pm) return "late_am";
  if (settledAt < tuesday0am) return "late_pm";
  return "missed";
}

const BAND_XP: Record<SettlementBand, number> = {
  early: 15,
  on_time: 5,
  late_am: -5,
  late_pm: -10,
  missed: -15,
};

export const refPayrollAdapter: Adapter = {
  slug: "ref_payroll",
  async sync(snapshotDate: Date): Promise<AdapterResult> {
    if (!sourceConfigured("ref_payroll")) return { slug: "ref_payroll", rollups: [], unconfigured: true };
    const sb = sourceClient("ref_payroll")!;

    const todayUTC = snapshotDate;
    const todayET = dateInTZ(todayUTC, ET_TZ);
    const todayDow = dowInTZ(todayUTC, ET_TZ);
    const todayHourET = hourInTZ(todayUTC, ET_TZ);

    // ---- Determine which (if any) deadline period is "active" today ----
    //
    // For SCORING: the most recent Monday on or before today is the
    // deadline_date_for_scoring IF it's <= 6 days behind. After that, the
    // period drops off and contributes nothing.
    //
    // For ACTION ITEMS: the upcoming Monday (today if today is Monday) is
    // the deadline_date_for_action.
    //
    // Both can coexist (e.g. on Saturday, last Monday's score still
    // reflects, AND next Monday's action item is visible).
    //
    // Either may be null if there's no active period to evaluate.

    const scoringDeadline = mondayOnOrBeforeET(todayUTC);
    const scoringDeadlineAgeDays = daysBetweenET(scoringDeadline, todayET);
    // Score only on the day AFTER deadline through 6 days after.
    // Don't score ON deadline day itself — that's still actionable.
    const scoreThisPeriod = scoringDeadlineAgeDays >= 1 && scoringDeadlineAgeDays <= 6;

    // Action-item deadline = upcoming Monday >= today (or today if today is Mon AM)
    let actionDeadlineDate: string | null = null;
    if (todayDow === 1) {
      // Monday — actionable all day until midnight
      actionDeadlineDate = todayET;
    } else if (todayDow === 6 || todayDow === 0) {
      // Saturday or Sunday — next Monday is the deadline
      const out = new Date(todayUTC);
      out.setUTCDate(out.getUTCDate() + (todayDow === 6 ? 2 : 1));
      actionDeadlineDate = dateInTZ(out, ET_TZ);
    }

    const lms = await listLMsFromCRM();
    const rollups: LMRollup[] = [];

    for (const lm of lms) {
      const rollup: LMRollup = { lm_email: lm.email, metrics: [], action_items: [] };
      const locationIds = await resolveLocationsForLM("ref_payroll", lm.email);

      if (!locationIds.length) {
        rollup.metrics.push({ metric_slug: "ref_payroll_on_time", raw_value: 0, max_score: 0, score: 0 });
        rollup.metrics.push({ metric_slug: "ref_payroll_late_hit", raw_value: 0, max_score: 0, score: 0 });
        rollup.metrics.push({ metric_slug: "ref_payroll_drag", raw_value: 0, max_score: 0, score: 0 });
        rollups.push(rollup);
        continue;
      }

      // Pull submissions for the periods we might evaluate (action + scoring).
      const periodsToCheck = new Set<string>();
      if (scoreThisPeriod) periodsToCheck.add(fridayBeforeMondayET(scoringDeadline));
      if (actionDeadlineDate) periodsToCheck.add(fridayBeforeMondayET(actionDeadlineDate));
      const periodEnds = Array.from(periodsToCheck);

      const subs = periodEnds.length
        ? (
            await sb
              .from("submissions")
              .select("id, location_id, pay_period_end, submitted_at, dm_decided_at, status")
              .in("location_id", locationIds)
              .in("pay_period_end", periodEnds)
          ).data ?? []
        : [];

      type Sub = {
        id: string; location_id: string; pay_period_end: string;
        submitted_at: string | null; dm_decided_at: string | null;
      };
      const subList = subs as Sub[];

      let positiveXp = 0;
      let positiveCount = 0;
      let negativeXp = 0;
      let negativeCount = 0;

      // ---- Scoring ----
      if (scoreThisPeriod) {
        const periodEnd = fridayBeforeMondayET(scoringDeadline);
        for (const locId of locationIds) {
          const sub = subList.find((s) => s.location_id === locId && s.pay_period_end === periodEnd);
          const band = classifySettlement(sub, scoringDeadline);
          const xp = BAND_XP[band];
          if (xp > 0) { positiveXp += xp; positiveCount++; }
          else if (xp < 0) { negativeXp += xp; negativeCount++; }
        }
      }

      // ---- Action items ----
      if (actionDeadlineDate) {
        const periodEnd = fridayBeforeMondayET(actionDeadlineDate);
        for (const locId of locationIds) {
          const sub = subList.find((s) => s.location_id === locId && s.pay_period_end === periodEnd);
          const settled = !!sub?.submitted_at && !!sub?.dm_decided_at;
          if (settled) continue;

          // Title + reward varies by where we are in the deadline arc
          if (todayDow === 6 || todayDow === 0) {
            // Saturday or Sunday — "early bird" window
            rollup.action_items.push({
              metric_slug: "ref_payroll_on_time",
              title: `Submit payroll ${periodEnd}`,
              detail: `Done by Sunday 11pm ET → +15 XP. Monday noon → +5 XP.`,
              severity: "medium",
              source_ref: `ref_payroll://submissions?location=${locId}&period=${periodEnd}`,
            });
          } else if (todayDow === 1 && todayHourET < 12) {
            // Monday AM — still earnable
            rollup.action_items.push({
              metric_slug: "ref_payroll_on_time",
              title: `Submit payroll ${periodEnd} by noon`,
              detail: `Submit + approve before 12pm ET → +5 XP. After noon, penalties kick in.`,
              severity: "high",
              source_ref: `ref_payroll://submissions?location=${locId}&period=${periodEnd}`,
            });
          } else if (todayDow === 1 && todayHourET < 18) {
            // Monday afternoon — late AM penalty zone
            rollup.action_items.push({
              metric_slug: "ref_payroll_late_hit",
              title: `URGENT: payroll ${periodEnd} past noon`,
              detail: `Penalty growing. -5 if done before 6pm ET, -10 by midnight, -15 after.`,
              severity: "critical",
              source_ref: `ref_payroll://submissions?location=${locId}&period=${periodEnd}`,
            });
          } else if (todayDow === 1 && todayHourET >= 18) {
            // Monday evening — last call
            rollup.action_items.push({
              metric_slug: "ref_payroll_late_hit",
              title: `LAST CALL: payroll ${periodEnd}`,
              detail: `Submit + approve before midnight → -10. After midnight → -15 LOCKED.`,
              severity: "critical",
              source_ref: `ref_payroll://submissions?location=${locId}&period=${periodEnd}`,
            });
          }
          // Tuesday onwards: no action item. Period locks.
        }
      }

      const maxPossible = scoreThisPeriod ? 15 * locationIds.length : 0;

      rollup.metrics.push({
        metric_slug: "ref_payroll_on_time",
        raw_value: positiveCount,
        max_score: maxPossible,
        score: positiveXp,
        payload: { positives_today: positiveCount },
      });
      rollup.metrics.push({
        metric_slug: "ref_payroll_late_hit",
        raw_value: negativeCount,
        max_score: 0,
        score: negativeXp,
        payload: { negatives_today: negativeCount },
      });
      // Drag metric retained as zero — used to accumulate forever, now retired.
      rollup.metrics.push({
        metric_slug: "ref_payroll_drag",
        raw_value: 0,
        max_score: 0,
        score: 0,
      });

      rollups.push(rollup);
    }

    return { slug: "ref_payroll", rollups };
  },
};
