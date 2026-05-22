import type { Adapter, AdapterResult, LMRollup } from "../types";
import { sourceClient, sourceConfigured } from "../clients";
import { ymd, daysAgo } from "../util";

/**
 * brodie-ref-payroll verified schema:
 *   profiles: id, email, full_name, role (lm|dm|payroll|vp|admin), slack_user_id, active
 *   user_locations: user_id, location_id
 *   submissions: id, location_id, pay_period_start (Sat), pay_period_end (Fri),
 *                status (submission_status), submitted_at, paid_at,
 *                dm_decided_at, payroll_decided_at, vp_decided_at
 *
 * "On time" target: refs paid by Tuesday after the pay_period_end (5 days).
 *
 * Sub-metrics:
 *   payouts_on_time (80%) — % of last 4 pay periods where submission.paid_at
 *                           is within 5 days of pay_period_end
 *   no_overdue      (20%) — count of submissions where pay_period_end was
 *                           > 7 days ago and paid_at is still null
 */
export const refPayrollAdapter: Adapter = {
  slug: "ref_payroll",
  async sync(snapshotDate: Date): Promise<AdapterResult> {
    if (!sourceConfigured("ref_payroll")) return { slug: "ref_payroll", rollups: [], unconfigured: true };
    const sb = sourceClient("ref_payroll")!;
    const today = ymd(snapshotDate);
    const twentyEightAgo = ymd(daysAgo(snapshotDate, 28));
    const sevenAgo = ymd(daysAgo(snapshotDate, 7));

    const { data: profiles, error: pErr } = await sb
      .from("profiles")
      .select("id, email, full_name, role, active");
    if (pErr) return { slug: "ref_payroll", rollups: [], error: pErr.message };
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
        rollup.metrics.push({ metric_slug: "payouts_on_time", raw_value: 100, max_score: 100, score: 100 });
        rollup.metrics.push({ metric_slug: "no_overdue",      raw_value: 0,   max_score: 100, score: 100 });
        rollups.push(rollup);
        continue;
      }

      const { data: submissions } = await sb
        .from("submissions")
        .select("id, location_id, pay_period_start, pay_period_end, paid_at, status")
        .in("location_id", locationIds)
        .gte("pay_period_start", twentyEightAgo);

      const subs = (submissions ?? []) as Array<{ id: string; pay_period_end: string; paid_at: string | null; status: string }>;
      const due = subs.filter((s) => s.pay_period_end <= today);

      const onTime = due.filter((s) => {
        if (!s.paid_at) return false;
        const paidDate = s.paid_at.slice(0, 10);
        // 5 days after Friday = following Wednesday; we allow Tue+1
        const target = new Date(s.pay_period_end);
        target.setUTCDate(target.getUTCDate() + 5);
        return paidDate <= target.toISOString().slice(0, 10);
      }).length;

      const overdue = due.filter((s) => !s.paid_at && s.pay_period_end < sevenAgo);

      const onTimeScore = due.length ? Math.round((onTime / due.length) * 100) : 100;
      rollup.metrics.push({
        metric_slug: "payouts_on_time",
        raw_value: onTime,
        max_score: 100,
        score: onTimeScore,
        payload: { window_days: 28, total: due.length, on_time: onTime },
      });
      if (onTimeScore < 90 && due.length > 0) {
        rollup.action_items.push({
          metric_slug: "payouts_on_time",
          title: `${due.length - onTime} ref payouts went out late in the last 4 weeks`,
          severity: onTimeScore < 70 ? "high" : "medium",
        });
      }

      const overdueScore = Math.max(0, 100 - overdue.length * 25);
      rollup.metrics.push({
        metric_slug: "no_overdue",
        raw_value: overdue.length,
        max_score: 100,
        score: overdueScore,
        payload: { overdue_count: overdue.length },
      });
      if (overdue.length > 0) {
        rollup.action_items.push({
          metric_slug: "no_overdue",
          title: `${overdue.length} ref payout${overdue.length > 1 ? "s" : ""} overdue by 7+ days`,
          severity: "critical",
        });
      }

      rollups.push(rollup);
    }
    return { slug: "ref_payroll", rollups };
  },
};
