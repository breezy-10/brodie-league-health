import { createAdminClient } from "@/lib/supabase/admin";
import { ADAPTERS } from "@/lib/source-apps";
import { ymd } from "@/lib/source-apps/util";
import { syncRoster } from "@/lib/roster";

type AppRow = { id: string; slug: string; weight: number; enabled: boolean };
type MetricRow = { id: string; app_id: string; slug: string; weight_within_app: number };
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

  const { data: apps } = await sb.from("apps").select("id, slug, weight, enabled");
  const { data: metrics } = await sb.from("metrics").select("id, app_id, slug, weight_within_app");
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
    if (!app) continue;

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
          score: mr.score,
          max_score: mr.max_score,
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
    if (actionRows.length) {
      await sb.from("daily_action_items").delete().eq("snapshot_date", dateStr).eq("app_id", app.id);
      await sb.from("daily_action_items").insert(actionRows);
    }

    report.push({ app: adapter.slug, status: "success", rows: totalSnapshotRows });
    if (runId) await sb.from("sync_runs").update({ status: "success", rows_synced: totalSnapshotRows, finished_at: new Date().toISOString() }).eq("id", runId);
  }

  return report;
}

/**
 * After daily_snapshots are written, compute XP per LM and write
 * lm_xp_totals. Done as a separate pass so weight tweaks can be re-applied
 * without re-syncing the source apps.
 */
export async function recomputeScores(date?: Date) {
  const sb = createAdminClient();
  const snapshotDate = date ?? new Date();
  const dateStr = ymd(snapshotDate);

  const { data: apps } = await sb.from("apps").select("id, slug, weight, enabled");
  const { data: metrics } = await sb.from("metrics").select("id, app_id, slug, weight_within_app, enabled");
  const { data: snapshots } = await sb
    .from("daily_snapshots")
    .select("lm_id, app_id, metric_id, score, max_score")
    .eq("snapshot_date", dateStr);

  const appById = new Map((apps as AppRow[] ?? []).map((a) => [a.id, a]));
  const metricById = new Map((metrics as MetricRow[] ?? []).map((m) => [m.id, m]));
  const totalAppWeight = (apps as AppRow[] ?? [])
    .filter((a) => a.enabled)
    .reduce((s, a) => s + Number(a.weight), 0) || 1;

  // metric weight totals within each app (for normalization)
  const appMetricTotal = new Map<string, number>();
  for (const m of (metrics as MetricRow[] ?? [])) {
    appMetricTotal.set(m.app_id, (appMetricTotal.get(m.app_id) ?? 0) + Number(m.weight_within_app));
  }

  type LMAgg = { xp: number; max: number; breakdown: Record<string, { score: number; max: number; metrics: Record<string, { score: number; max: number }> }> };
  const byLM = new Map<string, LMAgg>();

  for (const s of (snapshots ?? []) as Array<{ lm_id: string; app_id: string; metric_id: string; score: number; max_score: number }>) {
    const app = appById.get(s.app_id);
    const metric = metricById.get(s.metric_id);
    if (!app || !metric) continue;
    const appWeightShare = Number(app.weight) / totalAppWeight; // 0..1
    const metricTotal = appMetricTotal.get(app.id) || 1;
    const metricWeightShare = Number(metric.weight_within_app) / metricTotal;
    const contribution = s.score * appWeightShare * metricWeightShare;
    const maxContribution = s.max_score * appWeightShare * metricWeightShare;

    if (!byLM.has(s.lm_id)) byLM.set(s.lm_id, { xp: 0, max: 0, breakdown: {} });
    const agg = byLM.get(s.lm_id)!;
    agg.xp += contribution;
    agg.max += maxContribution;
    if (!agg.breakdown[app.slug]) agg.breakdown[app.slug] = { score: 0, max: 0, metrics: {} };
    agg.breakdown[app.slug].score += contribution;
    agg.breakdown[app.slug].max += maxContribution;
    agg.breakdown[app.slug].metrics[metric.slug] = { score: s.score, max: s.max_score };
  }

  const rows = [...byLM.entries()].map(([lm_id, agg]) => ({
    lm_id,
    snapshot_date: dateStr,
    total_xp: Math.round(agg.xp * 10) / 10,
    max_xp: Math.round(agg.max * 10) / 10,
    breakdown: agg.breakdown,
  }));

  if (rows.length) {
    await sb.from("lm_xp_totals").upsert(rows, { onConflict: "lm_id,snapshot_date" });
  }

  // assign rank_overall
  const sorted = [...rows].sort((a, b) => b.total_xp - a.total_xp);
  for (let i = 0; i < sorted.length; i++) {
    await sb
      .from("lm_xp_totals")
      .update({ rank_overall: i + 1 })
      .eq("lm_id", sorted[i].lm_id)
      .eq("snapshot_date", dateStr);
  }

  return { computed: rows.length, date: dateStr };
}
