import type { Adapter, AdapterResult, LMRollup } from "../types";
import { sourceClient, sourceConfigured } from "../clients";
import { ymd, daysAhead } from "../util";
import { addBusinessDays, businessDaysBetween } from "../business-days";
import { listLMsFromCRM, resolveFacilityCitiesForLM } from "../cross-app-locations";

/**
 * brodie-facilities — task-based scoring (v2, locked 2026-05-27).
 *
 * LMs are identified by the CRM managers list and scoped to facilities whose
 * `city` matches their assigned CRM location names (via fuzzy match).
 * They don't need a profile in the facilities app at all.
 *
 * Sub-metrics:
 *   invoice_followup (+5 each when resolved)  — action items per open
 *     invoice with scheduled_pay_date in next 4 business days. XP awarded
 *     by /api/me/action-resolve when LM clicks Done.
 *
 *   invoice_overdue (-3 per overdue invoice)  — applied today.
 *
 *   contract_gap (-3 per facility per day)  — active contract ending <30 days
 *     and no follow-on signed.
 */

const NOT_SCORED_STATUSES = ["paid", "void"];

export const facilitiesAdapter: Adapter = {
  slug: "facilities",
  async sync(snapshotDate: Date): Promise<AdapterResult> {
    if (!sourceConfigured("facilities")) return { slug: "facilities", rollups: [], unconfigured: true };
    const sb = sourceClient("facilities")!;

    const today = ymd(snapshotDate);
    const fourBDOut = ymd(addBusinessDays(snapshotDate, 4));
    const thirtyAhead = ymd(daysAhead(snapshotDate, 30));
    const sixtyAhead = ymd(daysAhead(snapshotDate, 60));

    const lms = await listLMsFromCRM();
    const rollups: LMRollup[] = [];

    for (const lm of lms) {
      const rollup: LMRollup = { lm_email: lm.email, metrics: [], action_items: [] };

      const cities = await resolveFacilityCitiesForLM(lm.email);
      if (!cities.length) {
        // No facilities at this LM's locations — no metrics emitted.
        rollups.push(rollup);
        continue;
      }

      // Pull facilities + invoices + contracts for those cities
      const { data: facilities } = await sb
        .from("facilities")
        .select("id, name, city")
        .in("city", cities);
      const facilityIds = ((facilities ?? []) as Array<{ id: string; city: string }>).map((f) => f.id);
      const facNameById = new Map(
        ((facilities ?? []) as Array<{ id: string; name: string }>).map((f) => [f.id, f.name])
      );
      if (!facilityIds.length) {
        rollups.push(rollup);
        continue;
      }

      // ---- invoice_followup: action items only ----
      const { data: openInvoices } = await sb
        .from("invoices")
        .select("id, facility_id, scheduled_pay_date, paid_date, status, amount_cents, currency, invoice_number")
        .in("facility_id", facilityIds)
        .not("status", "in", `(${NOT_SCORED_STATUSES.join(",")})`);

      const upcoming = ((openInvoices ?? []) as Array<{
        id: string; facility_id: string; scheduled_pay_date: string | null;
        paid_date: string | null; status: string; amount_cents: number;
        currency: string; invoice_number: string | null;
      }>).filter((i) =>
        i.scheduled_pay_date &&
        i.scheduled_pay_date >= today &&
        i.scheduled_pay_date <= fourBDOut
      );

      for (const inv of upcoming) {
        const amt = `${inv.currency} $${(inv.amount_cents / 100).toFixed(0)}`;
        const facName = facNameById.get(inv.facility_id) ?? "facility";
        rollup.action_items.push({
          metric_slug: "invoice_followup",
          title: `Follow up: invoice ${inv.invoice_number ? `#${inv.invoice_number}` : ""} ${facName}`,
          detail: `${amt} due ${inv.scheduled_pay_date}. Follow up with DM, mark done = +5 XP.`,
          severity: "high",
          source_ref: `facilities://invoices/${inv.id}`,
        });
      }
      rollup.metrics.push({
        metric_slug: "invoice_followup",
        raw_value: upcoming.length,
        max_score: upcoming.length * 5,
        score: 0,
        payload: { upcoming: upcoming.length, action_items_created: upcoming.length },
      });

      // ---- invoice_overdue ----
      const overdue = ((openInvoices ?? []) as Array<{ id: string; facility_id: string; scheduled_pay_date: string | null; invoice_number: string | null; amount_cents: number; currency: string }>)
        .filter((i) => i.scheduled_pay_date && i.scheduled_pay_date < today);
      const overdueXp = overdue.length * -3;

      rollup.metrics.push({
        metric_slug: "invoice_overdue",
        raw_value: overdue.length,
        max_score: 0,
        score: overdueXp,
        payload: { count: overdue.length },
      });

      for (const inv of overdue) {
        const amt = `${inv.currency} $${(inv.amount_cents / 100).toFixed(0)}`;
        const facName = facNameById.get(inv.facility_id) ?? "facility";
        const daysLate = businessDaysBetween(new Date(inv.scheduled_pay_date!), snapshotDate);
        rollup.action_items.push({
          metric_slug: "invoice_overdue",
          title: `Pay overdue invoice ${facName}`,
          detail: `${amt}, ${daysLate} business day${daysLate === 1 ? "" : "s"} late. -3 XP/day until paid.`,
          severity: "critical",
          source_ref: `facilities://invoices/${inv.id}`,
        });
      }

      // ---- contract_gap ----
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

      const gapFacs: Array<{ fid: string; expires: string }> = [];
      for (const fid of facilityIds) {
        const arr = (byFac.get(fid) ?? []).sort((a, b) => a.effective_end.localeCompare(b.effective_end));
        const current = arr.find((c) => c.effective_start <= today && c.effective_end >= today);
        if (!current) continue;
        if (current.effective_end <= thirtyAhead) {
          const hasFollowOn = arr.some(
            (c) => c.effective_start > current.effective_end && c.effective_start <= sixtyAhead
          );
          if (!hasFollowOn) gapFacs.push({ fid, expires: current.effective_end });
        }
      }

      const gapXp = gapFacs.length * -3;
      rollup.metrics.push({
        metric_slug: "contract_gap",
        raw_value: gapFacs.length,
        max_score: 0,
        score: gapXp,
        payload: { count: gapFacs.length },
      });
      for (const g of gapFacs) {
        const facName = facNameById.get(g.fid) ?? "a facility";
        rollup.action_items.push({
          metric_slug: "contract_gap",
          title: `Renew contract: ${facName}`,
          detail: `Expires ${g.expires} with no renewal. -3 XP/day until signed.`,
          severity: "high",
          source_ref: `facilities://contracts?facility=${g.fid}`,
        });
      }

      rollups.push(rollup);
    }

    return { slug: "facilities", rollups };
  },
};
