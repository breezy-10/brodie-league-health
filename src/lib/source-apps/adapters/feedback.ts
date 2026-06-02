import type { Adapter, AdapterResult, LMRollup } from "../types";
import { sourceClient, sourceConfigured } from "../clients";
import { ymd, daysAgo } from "../util";
import { listLMsFromCRM, resolveLocationsForLM } from "../cross-app-locations";

/**
 * brodie-feedback — NPS survey responses (v1, 2026-06-02).
 *
 * Source: brodie-feedback Supabase (qojmxikkvwtslfswkfna), table `responses`.
 * Each response has a `location_id` (joining feedback.locations) and an
 * `nps_score` (smallint, 0..10).
 *
 * Scoring (per LM, last 14 days of responses for their locations):
 *   feedback_promoter   +5  per NPS 9-10 response (player loved it)
 *   feedback_detractor  -10 per NPS <7 response (needs follow-up)
 *
 * Passives (7-8) are neutral — no score.
 *
 * Action items: one per detractor response. Title shows the contact + score.
 * The LM clicks "Lock in →" to deep-link to the feedback dashboard where
 * they can read the full open_feedback and reach out. After 14 days the
 * response drops off the window and the action item disappears.
 */
const WINDOW_DAYS = 14;
const PROMOTER_XP = 5;
const DETRACTOR_XP = -10;

export const feedbackAdapter: Adapter = {
  slug: "feedback",
  async sync(snapshotDate: Date): Promise<AdapterResult> {
    if (!sourceConfigured("feedback"))
      return { slug: "feedback", rollups: [], unconfigured: true };
    const sb = sourceClient("feedback")!;

    const windowStart = ymd(daysAgo(snapshotDate, WINDOW_DAYS));

    const lms = await listLMsFromCRM();
    const rollups: LMRollup[] = [];

    for (const lm of lms) {
      const rollup: LMRollup = { lm_email: lm.email, metrics: [], action_items: [] };
      const locationIds = await resolveLocationsForLM("feedback", lm.email);

      if (!locationIds.length) {
        // No mapped locations → emit zeros so the engine still records the
        // adapter ran for this LM.
        rollup.metrics.push({ metric_slug: "feedback_promoter", raw_value: 0, max_score: 0, score: 0 });
        rollup.metrics.push({ metric_slug: "feedback_detractor", raw_value: 0, max_score: 0, score: 0 });
        rollups.push(rollup);
        continue;
      }

      const { data: responses } = await sb
        .from("responses")
        .select("id, submitted_at, location_id, nps_score, composite_csat, contact_first_name, contact_last_name, contact_email, open_feedback")
        .in("location_id", locationIds)
        .gte("submitted_at", `${windowStart}T00:00:00Z`)
        .not("nps_score", "is", null)
        .order("submitted_at", { ascending: false });

      type Resp = {
        id: string;
        submitted_at: string;
        location_id: string;
        nps_score: number;
        composite_csat: number | null;
        contact_first_name: string | null;
        contact_last_name: string | null;
        contact_email: string | null;
        open_feedback: string | null;
      };
      const list = (responses ?? []) as Resp[];

      let promoterCount = 0;
      let detractorCount = 0;

      for (const r of list) {
        const nps = Number(r.nps_score);
        if (nps >= 9) {
          promoterCount++;
        } else if (nps < 7) {
          detractorCount++;

          // One action item per detractor. Sort by most recent on the
          // engine side (we already ordered desc, so the first ones in the
          // list will surface first when the AppCard collapses past N).
          const firstName = r.contact_first_name?.trim() || "Anonymous";
          const lastName = r.contact_last_name?.trim() || "";
          const who = [firstName, lastName].filter(Boolean).join(" ");
          const snippet = (r.open_feedback ?? "").trim().replace(/\s+/g, " ").slice(0, 80);

          rollup.action_items.push({
            metric_slug: "feedback_detractor",
            title: `Follow up: ${who} (NPS ${nps})`,
            detail: snippet || "No written feedback — call or DM to follow up.",
            severity: nps <= 3 ? "critical" : nps <= 5 ? "high" : "medium",
            source_ref: `feedback://responses/${r.id}`,
          });
        }
        // Passives (7-8): no score, no action item
      }

      const promoterXp = promoterCount * PROMOTER_XP;
      const detractorXp = detractorCount * DETRACTOR_XP;

      // Max for promoter metric scales with response volume so an LM with a
      // busy location isn't capped artificially. Cap detractor max at 0 so
      // it shows up as pure penalty.
      const promoterMax = Math.max(promoterCount * PROMOTER_XP, list.length * PROMOTER_XP * 0.5);

      rollup.metrics.push({
        metric_slug: "feedback_promoter",
        raw_value: promoterCount,
        max_score: Math.round(promoterMax),
        score: promoterXp,
        payload: { promoter_count: promoterCount, total_responses: list.length },
      });
      rollup.metrics.push({
        metric_slug: "feedback_detractor",
        raw_value: detractorCount,
        max_score: 0,
        score: detractorXp,
        payload: { detractor_count: detractorCount, total_responses: list.length },
      });

      rollups.push(rollup);
    }

    return { slug: "feedback", rollups };
  },
};
