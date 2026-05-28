import { createAdminClient } from "@/lib/supabase/admin";
import { ADAPTERS } from "@/lib/source-apps";
import { ymd } from "@/lib/source-apps/util";
import { syncRoster } from "@/lib/roster";
import { clearLocationCache } from "@/lib/source-apps/cross-app-locations";

type AppRow = { id: string; slug: string; weight: number; enabled: boolean; xp_floor: number };
type MetricRow = { id: string; app_id: string; slug: string };
type LMRow = { id: string; email: string };

export type SyncReport = {
  app: string;
  status: "success" | "partial" | "error" | "unconfigured";
  rows: number;
  error?: string;
};

/**
 * Pulls from every adapter, writes daily_snapshots + daily_action_items,
 * then rolls up XP per LM for the day.
 */
export async function runDailySync(opts?: { triggeredBy?: "cron" | "manual"; date?: Date }) {
  const sb = createAdminClient();
  const snapshotDate = opts?.date ?? new Date();
  const dateStr = ymd(snapshotDate);

  await syncRoster();
  clearLocationCache();
  // (welcomeNewLMs moved to the 8am ET slack-digest cron so welcome DMs
  // land at phone-checking time, not 5am ET when sync runs.)

  // Skip disabled apps (e.g. ops_schedule until that app is built out).
  const { data: apps } = await sb.from("apps").select("id, slug, weight, enabled, xp_floor").eq("enabled", true);
  const { data: metrics } = await sb.from("metrics").select("id, app_id, slug");
  const { data: lms } = await sb.from("league_managers").select("id, email").eq("active", true);

  const appBySlug = new Map((apps as AppRow[] ?? []).map((a) => [a.slug, a]));
  const metricsByApp = new Map<string, MetricRow[]>();
  for (const m of (metrics as MetricRow[] ?? [])) {
    if (!metricsByApp.has(m.app_id)) metricsByApp.set(m.app_id, []);
    metricsByApp.get(m.app_id)!.push(m);
  }
  const lmByEmail = new Map((lms as LMRow[] ?? []).map((l) => [l.email.toLowerCase(), l]));

  const report: SyncReport[] = [];

  for (const adapter of ADAPTERS) {
    const app = appBySlug.get(adapter.slug);
    if (!app) {
      // adapter exists but app disabled — skip silently
      continue;
    }

    const { data: runRow } = await sb
      .from("sync_runs")
      .insert({ app_id: app.id, status: "running", triggered_by: opts?.triggeredBy ?? "cron" })
      .select("id")
      .single();
    const runId = (runRow as { id: string } | null)?.id;

    let result;
    try {
      result = await adapter.sync(snapshotDate);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      report.push({ app: adapter.slug, status: "error", rows: 0, error: msg });
      if (runId) await sb.from("sync_runs").update({ status: "error", error: msg, finished_at: new Date().toISOString() }).eq("id", runId);
      continue;
    }

    if (result.unconfigured) {
      report.push({ app: adapter.slug, status: "unconfigured", rows: 0 });
      if (runId) await sb.from("sync_runs").update({ status: "partial", error: "unconfigured", finished_at: new Date().toISOString() }).eq("id", runId);
      continue;
    }

    if (result.error) {
      report.push({ app: adapter.slug, status: "error", rows: 0, error: result.error });
      if (runId) await sb.from("sync_runs").update({ status: "error", error: result.error, finished_at: new Date().toISOString() }).eq("id", runId);
      continue;
    }

    const metricList = metricsByApp.get(app.id) ?? [];
    const metricBySlug = new Map(metricList.map((m) => [m.slug, m]));

    let totalSnapshotRows = 0;
    const snapshotRows: Array<Record<string, unknown>> = [];
    const actionRows: Array<Record<string, unknown>> = [];

    for (const rollup of result.rollups) {
      const lm = lmByEmail.get(rollup.lm_email.toLowerCase());
      if (!lm) continue;

      for (const mr of rollup.metrics) {
        const metric = metricBySlug.get(mr.metric_slug);
        if (!metric) continue;
        snapshotRows.push({
          lm_id: lm.id,
          app_id: app.id,
          metric_id: metric.id,
          snapshot_date: dateStr,
          raw_value: mr.raw_value,
          raw_payload: mr.payload ?? {},
          score: mr.score,           // task-based XP value (can be negative)
          max_score: mr.max_score,   // potential XP if perfect (display only)
        });
        totalSnapshotRows++;
      }

      for (const ai of rollup.action_items) {
        const metric = metricBySlug.get(ai.metric_slug);
        actionRows.push({
          lm_id: lm.id,
          app_id: app.id,
          metric_id: metric?.id ?? null,
          snapshot_date: dateStr,
          title: ai.title,
          detail: ai.detail ?? null,
          severity: ai.severity,
          source_ref: ai.source_ref ?? null,
        });
      }
    }

    if (snapshotRows.length) {
      await sb.from("daily_snapshots").upsert(snapshotRows, { onConflict: "lm_id,metric_id,snapshot_date" });
    }
    // Always wipe stale action items for this app+date first — otherwise rows
    // from earlier sync runs (or from old adapter logic) leak through when
    // the new adapter emits zero items.
    await sb.from("daily_action_items").delete().eq("snapshot_date", dateStr).eq("app_id", app.id);
    if (actionRows.length) {
      await sb.from("daily_action_items").insert(actionRows);
    }

    report.push({ app: adapter.slug, status: "success", rows: totalSnapshotRows });
    if (runId) await sb.from("sync_runs").update({ status: "success", rows_synced: totalSnapshotRows, finished_at: new Date().toISOString() }).eq("id", runId);
  }

  return report;
}

/**
 * Task-based scoring (v2): sum raw XP per LM per app, then multiply by
 * app.weight (a 0–2 multiplier). Apply per-app xp_floor so a single bad
 * domain can't tank the total beyond a floor. No share-normalization.
 */
export async function recomputeScores(date?: Date) {
  const sb = createAdminClient();
  const snapshotDate = date ?? new Date();
  const dateStr = ymd(snapshotDate);

  const { data: apps } = await sb.from("apps").select("id, slug, weight, enabled, xp_floor").eq("enabled", true);
  const { data: metrics } = await sb.from("metrics").select("id, app_id, slug");
  const { data: snapshots } = await sb
    .from("daily_snapshots")
    .select("lm_id, app_id, metric_id, score, max_score")
    .eq("snapshot_date", dateStr);

  // New-LM ramp: pull hired_at for each active LM. Within first 30 days,
  // soften each per-app xp_floor by half and grant a +5 daily ramp credit.
  const { data: lmHires } = await sb
    .from("league_managers")
    .select("id, hired_at")
    .eq("active", true);
  const RAMP_DAYS = 30;
  const RAMP_DAILY_CREDIT = 5;
  const rampByLm = new Map<string, { in_ramp: boolean; days_since_hire: number | null }>();
  for (const r of (lmHires ?? []) as Array<{ id: string; hired_at: string | null }>) {
    if (!r.hired_at) {
      rampByLm.set(r.id, { in_ramp: false, days_since_hire: null });
      continue;
    }
    const hired = new Date(r.hired_at + "T00:00:00Z").getTime();
    const days = Math.floor((snapshotDate.getTime() - hired) / 86400000);
    rampByLm.set(r.id, { in_ramp: days >= 0 && days < RAMP_DAYS, days_since_hire: days });
  }

  const appById = new Map((apps as AppRow[] ?? []).map((a) => [a.id, a]));
  const metricById = new Map((metrics as MetricRow[] ?? []).map((m) => [m.id, m]));

  type AppAgg = { rawXp: number; rawMax: number; metrics: Record<string, { score: number; max: number }> };
  type LMAgg = { totalXp: number; maxXp: number; perApp: Record<string, AppAgg> };
  const byLM = new Map<string, LMAgg>();

  for (const s of (snapshots ?? []) as Array<{ lm_id: string; app_id: string; metric_id: string; score: number; max_score: number }>) {
    const app = appById.get(s.app_id);
    const metric = metricById.get(s.metric_id);
    if (!app || !metric) continue;

    if (!byLM.has(s.lm_id)) byLM.set(s.lm_id, { totalXp: 0, maxXp: 0, perApp: {} });
    const agg = byLM.get(s.lm_id)!;
    const appBucket = (agg.perApp[app.slug] ??= { rawXp: 0, rawMax: 0, metrics: {} });
    appBucket.rawXp += Number(s.score);
    appBucket.rawMax += Number(s.max_score);
    appBucket.metrics[metric.slug] = { score: Number(s.score), max: Number(s.max_score) };
  }

  // apply per-app multiplier + floor (ramp-softened for new LMs)
  for (const [lmId, agg] of byLM) {
    const ramp = rampByLm.get(lmId) ?? { in_ramp: false, days_since_hire: null };
    for (const [slug, bucket] of Object.entries(agg.perApp)) {
      const app = [...appById.values()].find((a) => a.slug === slug);
      if (!app) continue;
      const mult = Number(app.weight);
      const baseFloor = Number(app.xp_floor);
      // Soften the floor to half during ramp window (e.g. -20 → -10)
      const floor = ramp.in_ramp ? baseFloor / 2 : baseFloor;
      const scaled = bucket.rawXp * mult;
      const flooredScaled = Math.max(scaled, floor);
      const scaledMax = bucket.rawMax * mult;
      agg.totalXp += flooredScaled;
      agg.maxXp += scaledMax;
      bucket.rawXp = flooredScaled;
      bucket.rawMax = scaledMax;
    }
    // Grant ramp credit once per day for LMs in their first 30 days
    if (ramp.in_ramp) {
      agg.totalXp += RAMP_DAILY_CREDIT;
      agg.maxXp += RAMP_DAILY_CREDIT;
      // Expose it as a virtual "ramp" app in the breakdown so the LM sees
      // the boost on My Day and understands where the +5 came from.
      agg.perApp["ramp"] = {
        rawXp: RAMP_DAILY_CREDIT,
        rawMax: RAMP_DAILY_CREDIT,
        metrics: {
          ramp_credit: { score: RAMP_DAILY_CREDIT, max: RAMP_DAILY_CREDIT },
        },
      };
    }
  }

  // shape breakdown for storage (same shape MyDay reads today)
  type Breakdown = Record<string, { score: number; max: number; metrics: Record<string, { score: number; max: number }> }>;
  const rows = [...byLM.entries()].map(([lm_id, agg]) => {
    const breakdown: Breakdown = {};
    for (const [slug, bucket] of Object.entries(agg.perApp)) {
      breakdown[slug] = { score: bucket.rawXp, max: bucket.rawMax, metrics: bucket.metrics };
    }
    return {
      lm_id,
      snapshot_date: dateStr,
      total_xp: Math.round(agg.totalXp * 10) / 10,
      max_xp: Math.round(agg.maxXp * 10) / 10,
      breakdown,
    };
  });

  if (rows.length) {
    await sb.from("lm_xp_totals").upsert(rows, { onConflict: "lm_id,snapshot_date" });
  }

  // ranks
  const sorted = [...rows].sort((a, b) => b.total_xp - a.total_xp);
  for (let i = 0; i < sorted.length; i++) {
    await sb
      .from("lm_xp_totals")
      .update({ rank_overall: i + 1 })
      .eq("lm_id", sorted[i].lm_id)
      .eq("snapshot_date", dateStr);
  }

  // gamification pass (streaks, tiers, achievements)
  try {
    const { recomputeGamification } = await import("./gamification");
    await recomputeGamification(snapshotDate);
  } catch (e) {
    console.error("gamification pass failed:", e);
  }

  return { computed: rows.length, date: dateStr };
}
