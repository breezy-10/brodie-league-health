import type { Adapter, AdapterResult, LMRollup } from "../types";
import { sourceClient, sourceConfigured } from "../clients";
import { ymd, daysAhead } from "../util";

/**
 * brodie-facilities verified schema:
 *   profiles: id, email, full_name, role (enum: lm|dm|finance|admin), active
 *   user_facilities: user_id, facility_id (composite PK)
 *   invoices: facility_id, scheduled_pay_date (date), paid_date (date),
 *             status (enum: 'unpaid' | 'scheduled' | 'paid'), amount_cents
 *   contracts: facility_id, effective_start (date), effective_end (date), signed_date
 *
 * Sub-metrics:
 *   invoice_on_time    (60%) — % open invoices NOT past scheduled_pay_date
 *   contract_gap_risk  (40%) — penalty per facility with no active contract,
 *                              or current contract ending in <30d with no follow-on
 */
export const facilitiesAdapter: Adapter = {
  slug: "facilities",
  async sync(snapshotDate: Date): Promise<AdapterResult> {
    if (!sourceConfigured("facilities")) return { slug: "facilities", rollups: [], unconfigured: true };
    const sb = sourceClient("facilities")!;
    const today = ymd(snapshotDate);
    const thirtyAhead = ymd(daysAhead(snapshotDate, 30));
    const sixtyAhead = ymd(daysAhead(snapshotDate, 60));

    const { data: profiles, error: pErr } = await sb
      .from("profiles")
      .select("id, email, full_name, role, active");
    if (pErr) return { slug: "facilities", rollups: [], error: pErr.message };
    const lms = (profiles ?? []).filter(
      (p: { role: string; active: boolean }) => (p.role === "lm" || p.role === "dm") && p.active
    ) as Array<{ id: string; email: string }>;

    const rollups: LMRollup[] = [];
    for (const lm of lms) {
      const { data: links } = await sb
        .from("user_facilities")
        .select("facility_id")
        .eq("user_id", lm.id);
      const facilityIds = (links ?? []).map((l: { facility_id: string }) => l.facility_id);

      const rollup: LMRollup = { lm_email: lm.email, metrics: [], action_items: [] };

      if (!facilityIds.length) {
        rollup.metrics.push({ metric_slug: "invoice_on_time", raw_value: 100, max_score: 100, score: 100 });
        rollup.metrics.push({ metric_slug: "contract_gap_risk", raw_value: 0, max_score: 100, score: 100 });
        rollups.push(rollup);
        continue;
      }

      // invoice_on_time
      const { data: invoices } = await sb
        .from("invoices")
        .select("id, scheduled_pay_date, paid_date, status, amount_cents, facility_id")
        .in("facility_id", facilityIds)
        .in("status", ["unpaid", "scheduled"]);
      const open = (invoices ?? []) as Array<{ id: string; scheduled_pay_date: string | null; paid_date: string | null; status: string; amount_cents: number; facility_id: string }>;
      const overdue = open.filter((i) => i.scheduled_pay_date && i.scheduled_pay_date < today);
      const onTimePct = open.length ? Math.round(((open.length - overdue.length) / open.length) * 100) : 100;
      rollup.metrics.push({
        metric_slug: "invoice_on_time",
        raw_value: onTimePct,
        max_score: 100,
        score: onTimePct,
        payload: { open: open.length, overdue: overdue.length },
      });
      if (overdue.length > 0) {
        rollup.action_items.push({
          metric_slug: "invoice_on_time",
          title: `${overdue.length} overdue invoice${overdue.length > 1 ? "s" : ""} at your facilities`,
          detail: "Get the facility to issue payment or escalate to ops.",
          severity: overdue.length > 2 ? "critical" : "high",
          source_ref: "facilities://invoices",
        });
      }

      // contract_gap_risk
      const { data: contracts } = await sb
        .from("contracts")
        .select("id, facility_id, effective_start, effective_end")
        .in("facility_id", facilityIds);
      const byFac = new Map<string, Array<{ effective_start: string; effective_end: string }>>();
      for (const c of (contracts ?? []) as Array<{ facility_id: string; effective_start: string; effective_end: string }>) {
        if (!c.effective_start || !c.effective_end) continue;
        const arr = byFac.get(c.facility_id) ?? [];
        arr.push(c);
        byFac.set(c.facility_id, arr);
      }
      let gaps = 0;
      for (const fid of facilityIds) {
        const arr = (byFac.get(fid) ?? []).sort((a, b) => a.effective_end.localeCompare(b.effective_end));
        const current = arr.find((c) => c.effective_start <= today && c.effective_end >= today);
        if (!current) {
          gaps++;
          rollup.action_items.push({
            metric_slug: "contract_gap_risk",
            title: "Facility has no active contract",
            severity: "critical",
            source_ref: `facilities://contracts/${fid}`,
          });
          continue;
        }
        if (current.effective_end <= thirtyAhead) {
          const hasFollowOn = arr.some(
            (c) => c.effective_start > current.effective_end && c.effective_start <= sixtyAhead
          );
          if (!hasFollowOn) {
            gaps++;
            rollup.action_items.push({
              metric_slug: "contract_gap_risk",
              title: `Contract expires ${current.effective_end} with no renewal lined up`,
              severity: "high",
              source_ref: `facilities://contracts/${fid}`,
            });
          }
        }
      }
      const gapScore = facilityIds.length
        ? Math.max(0, Math.round((1 - gaps / facilityIds.length) * 100))
        : 100;
      rollup.metrics.push({
        metric_slug: "contract_gap_risk",
        raw_value: gaps,
        max_score: 100,
        score: gapScore,
        payload: { facilities: facilityIds.length, gaps },
      });

      rollups.push(rollup);
    }
    return { slug: "facilities", rollups };
  },
};
