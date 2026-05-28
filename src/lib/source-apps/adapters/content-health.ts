import type { Adapter, AdapterResult, LMRollup } from "../types";
import { sourceClient, sourceConfigured } from "../clients";
import { ymd, daysAgo } from "../util";
import { listLMsFromCRM, resolveLocationsForLM } from "../cross-app-locations";

/**
 * brodie-content-health — clips-per-hour scoring (v2, locked 2026-05-27).
 *
 * Each content_night gets scored once, on the day AFTER it occurs:
 *
 *   content_ratio_hit       +10  if iphone_clips_count >= 20 * ahs_hours
 *   content_ratio_miss      -3   if clips_count < 20 * ahs_hours (and both not null)
 *   content_post_12h_bonus  +3   if iphone_clips_posted_at within 12h of
 *                                  night's end (night.date + 24h)
 *
 * Plus the continuous penalty:
 *   content_never_posted    -2 each day per night >7 days old where
 *                                iphone_clips_posted_at is null.
 */
const TARGET_RATIO = 20;
const BONUS_WINDOW_HOURS = 12;

export const contentHealthAdapter: Adapter = {
  slug: "content_health",
  async sync(snapshotDate: Date): Promise<AdapterResult> {
    if (!sourceConfigured("content_health")) return { slug: "content_health", rollups: [], unconfigured: true };
    const sb = sourceClient("content_health")!;

    const todayStr = ymd(snapshotDate);
    const yesterdayStr = ymd(daysAgo(snapshotDate, 1));
    const thirtyDaysAgo = ymd(daysAgo(snapshotDate, 30));

    const lms = await listLMsFromCRM();
    const rollups: LMRollup[] = [];

    for (const lm of lms) {
      const locationIds = await resolveLocationsForLM("content_health", lm.email);
      const rollup: LMRollup = { lm_email: lm.email, metrics: [], action_items: [] };

      if (!locationIds.length) {
        rollups.push(rollup);
        continue;
      }

      const { data: nights } = await sb
        .from("content_nights")
        .select("id, location_id, date, ahs_hours, iphone_clips_count, iphone_clips_posted_at")
        .in("location_id", locationIds)
        .gte("date", thirtyDaysAgo)
        .lte("date", todayStr);

      type Night = {
        id: string;
        location_id: string;
        date: string;
        ahs_hours: number | null;
        iphone_clips_count: number | null;
        iphone_clips_posted_at: string | null;
      };
      const allNights = (nights ?? []) as Night[];

      // ----- Score YESTERDAY's nights once: ratio + 12h bonus -----
      const yesterdayNights = allNights.filter((n) => n.date === yesterdayStr);
      let ratioHitXp = 0, ratioHitCount = 0;
      let ratioMissXp = 0, ratioMissCount = 0;
      let bonusXp = 0, bonusCount = 0;

      for (const n of yesterdayNights) {
        if (n.iphone_clips_count != null && n.ahs_hours != null && n.ahs_hours > 0) {
          const target = TARGET_RATIO * Number(n.ahs_hours);
          if (n.iphone_clips_count >= target) {
            ratioHitXp += 10;
            ratioHitCount++;
            rollup.action_items.push({
              metric_slug: "content_ratio_hit",
              title: `Hit clip target ${n.date}`,
              detail: `${n.iphone_clips_count}/${target.toFixed(0)} clips (+10 XP)`,
              severity: "low",
            });
          } else {
            ratioMissXp -= 3;
            ratioMissCount++;
            rollup.action_items.push({
              metric_slug: "content_ratio_miss",
              title: `Missed clips ${n.date}`,
              detail: `${n.iphone_clips_count}/${target.toFixed(0)} clips, ${(20 - n.iphone_clips_count / Number(n.ahs_hours)).toFixed(1)}/hr short. -3 XP.`,
              severity: "medium",
            });
          }
        }
        if (n.iphone_clips_posted_at) {
          const nightEnd = new Date(n.date + "T23:59:59Z").getTime();
          const posted = new Date(n.iphone_clips_posted_at).getTime();
          if (posted - nightEnd <= BONUS_WINDOW_HOURS * 3600 * 1000) {
            bonusXp += 3;
            bonusCount++;
          }
        }
      }

      // ----- Continuous penalty: nights >7d old with no posted_at -----
      const sevenAgo = ymd(daysAgo(snapshotDate, 7));
      const ghosted = allNights.filter((n) => n.date < sevenAgo && !n.iphone_clips_posted_at);
      const ghostedXp = ghosted.length * -2;

      for (const g of ghosted.slice(0, 5)) {
        rollup.action_items.push({
          metric_slug: "content_never_posted",
          title: `Post clips: ${g.date}`,
          detail: "No iPhone clips posted yet. -2 XP/day until posted.",
          severity: "high",
          source_ref: `content_health://nights/${g.id}`,
        });
      }
      if (ghosted.length > 5) {
        rollup.action_items.push({
          metric_slug: "content_never_posted",
          title: `+${ghosted.length - 5} more nights to post`,
          severity: "high",
        });
      }

      // ----- Emit metric snapshots -----
      rollup.metrics.push({
        metric_slug: "content_ratio_hit",
        raw_value: ratioHitCount,
        max_score: yesterdayNights.length * 10,
        score: ratioHitXp,
        payload: { ratio_hit_count: ratioHitCount, nights_yesterday: yesterdayNights.length },
      });
      rollup.metrics.push({
        metric_slug: "content_ratio_miss",
        raw_value: ratioMissCount,
        max_score: 0,
        score: ratioMissXp,
        payload: { ratio_miss_count: ratioMissCount },
      });
      rollup.metrics.push({
        metric_slug: "content_post_12h_bonus",
        raw_value: bonusCount,
        max_score: yesterdayNights.length * 3,
        score: bonusXp,
        payload: { bonus_count: bonusCount },
      });
      rollup.metrics.push({
        metric_slug: "content_never_posted",
        raw_value: ghosted.length,
        max_score: 0,
        score: ghostedXp,
        payload: { ghosted_count: ghosted.length },
      });

      rollups.push(rollup);
    }

    return { slug: "content_health", rollups };
  },
};
