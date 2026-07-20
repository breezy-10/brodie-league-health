import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { recomputeScores } from "@/lib/scoring/engine";
import { ymd, daysAgo } from "@/lib/source-apps/util";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Wipes any prior demo data and seeds 6 fake LMs with 14 days of realistic
 * snapshots, plus today's action items. Lets you see every UI state populated
 * without waiting on source-app keys.
 *
 * Demo LMs use *.demo@brodierec.local emails so they're easy to spot and
 * cleanly removable.
 */
const DEMO_DOMAIN = "@brodierec.local";

type Persona = {
  email: string;
  name: string;
  location: string;
  district: string;
  archetype: "champ" | "solid" | "average" | "struggling" | "wildcard" | "comeback";
};

const PERSONAS: Persona[] = [
  { email: "marcus.demo@brodierec.local", name: "Marcus King",     location: "Toronto Downtown",  district: "GTA",      archetype: "champ" },
  { email: "jess.demo@brodierec.local",   name: "Jess Holloway",   location: "Toronto Etobicoke", district: "GTA",      archetype: "solid" },
  { email: "diego.demo@brodierec.local",  name: "Diego Rivera",    location: "Mississauga",       district: "GTA",      archetype: "average" },
  { email: "priya.demo@brodierec.local",  name: "Priya Shah",      location: "Hamilton",          district: "GTA",      archetype: "comeback" },
  { email: "ty.demo@brodierec.local",     name: "Ty Wallace",      location: "Boston Cambridge",  district: "US East",  archetype: "struggling" },
  { email: "sasha.demo@brodierec.local",  name: "Sasha Morell",    location: "NYC Brooklyn",      district: "US East",  archetype: "wildcard" },
];

function archetypeScore(arch: Persona["archetype"], dayIndex: number): number {
  // dayIndex 0 = 14 days ago, 13 = today
  const noise = (Math.sin(dayIndex * 1.3) + Math.cos(dayIndex * 0.7)) * 8;
  switch (arch) {
    case "champ":      return clamp(92 + noise * 0.4);
    case "solid":      return clamp(82 + noise * 0.6);
    case "average":    return clamp(70 + noise);
    case "struggling": return clamp(48 + noise);
    case "wildcard":   return clamp(50 + Math.sin(dayIndex * 0.9) * 28);
    case "comeback":   return clamp(40 + dayIndex * 3.2); // climbs over time
  }
}
function clamp(n: number) { return Math.max(0, Math.min(100, Math.round(n))); }

export async function POST() {
  await requireRole(["super_admin"]);
  const sb = createAdminClient();

  // wipe prior demo data
  const { data: priorLms } = await sb
    .from("league_managers")
    .select("id")
    .like("email", `%${DEMO_DOMAIN}`);
  const priorIds = (priorLms ?? []).map((l: { id: string }) => l.id);
  if (priorIds.length) {
    await sb.from("daily_action_items").delete().in("lm_id", priorIds);
    await sb.from("daily_snapshots").delete().in("lm_id", priorIds);
    await sb.from("lm_xp_totals").delete().in("lm_id", priorIds);
    await sb.from("lm_achievements").delete().in("lm_id", priorIds);
    await sb.from("league_managers").delete().in("id", priorIds);
  }

  // create LMs
  const lmRows = PERSONAS.map((p) => ({
    email: p.email,
    full_name: p.name,
    location_name: p.location,
    district: p.district,
    active: true,
  }));
  const { data: insertedLms, error: lmErr } = await sb
    .from("league_managers")
    .insert(lmRows)
    .select("id, email");
  if (lmErr) return NextResponse.json({ error: lmErr.message }, { status: 500 });
  const lmIdByEmail = new Map((insertedLms ?? []).map((l: { id: string; email: string }) => [l.email, l.id]));

  // metric + app lookup
  const { data: apps } = await sb.from("apps").select("id, slug, weight");
  const { data: metrics } = await sb.from("metrics").select("id, app_id, slug, weight_within_app");
  type App = { id: string; slug: string; weight: number };
  type Metric = { id: string; app_id: string; slug: string; weight_within_app: number };
  const appList = (apps ?? []) as App[];
  const metricList = (metrics ?? []) as Metric[];

  // 14 days of snapshots per LM per metric
  const today = new Date();
  const snapshotRows: Array<Record<string, unknown>> = [];

  for (const persona of PERSONAS) {
    const lmId = lmIdByEmail.get(persona.email);
    if (!lmId) continue;

    for (let i = 0; i < 14; i++) {
      const date = daysAgo(today, 13 - i);
      const dateStr = ymd(date);
      const dayScore = archetypeScore(persona.archetype, i);

      for (const m of metricList) {
        // give each metric a slight variance around the day score
        const jitter = (((m.slug.charCodeAt(0) + i) % 11) - 5) * 1.4;
        const metricScore = clamp(dayScore + jitter);
        snapshotRows.push({
          lm_id: lmId,
          app_id: m.app_id,
          metric_id: m.id,
          snapshot_date: dateStr,
          raw_value: metricScore,
          raw_payload: { source: "demo" },
          score: metricScore,
          max_score: 100,
        });
      }
    }
  }

  // batch insert in chunks of 500
  for (let i = 0; i < snapshotRows.length; i += 500) {
    const chunk = snapshotRows.slice(i, i + 500);
    const { error } = await sb.from("daily_snapshots").upsert(chunk, { onConflict: "lm_id,metric_id,snapshot_date" });
    if (error) return NextResponse.json({ error: `snapshots: ${error.message}` }, { status: 500 });
  }

  // today's action items per persona (1-4 items based on score)
  const todayStr = ymd(today);
  const actionTemplates = [
    { app: "crm",         title: "12 captains haven't heard from you in 7+ days",        severity: "high" },
    { app: "facilities",  title: "1 overdue invoice at Cambridge — escalate to ops",     severity: "critical" },
    { app: "ref_payroll", title: "Last week's submission still pending payroll approval", severity: "medium" },
    { app: "training",    title: "3 of your part-timers aren't fully certified",         severity: "medium" },
    { app: "stats_health", title: "2 games missing stats within 24h SLA",                 severity: "medium" },
    { app: "content_health", title: "Friday's content night missed the 48h video window", severity: "medium" },
    { app: "ops_schedule", title: "2 unfilled shifts in the next 7 days",                 severity: "high" },
  ];
  const appIdBySlug = new Map(appList.map((a) => [a.slug, a.id]));

  const actionRows: Array<Record<string, unknown>> = [];
  for (const persona of PERSONAS) {
    const lmId = lmIdByEmail.get(persona.email);
    if (!lmId) continue;
    const score = archetypeScore(persona.archetype, 13);
    const numItems = score >= 90 ? 0 : score >= 75 ? 2 : score >= 55 ? 4 : 5;
    const picks = [...actionTemplates].sort(() => Math.random() - 0.5).slice(0, numItems);
    for (const p of picks) {
      const aid = appIdBySlug.get(p.app);
      if (!aid) continue;
      actionRows.push({
        lm_id: lmId,
        app_id: aid,
        snapshot_date: todayStr,
        title: p.title,
        severity: p.severity,
      });
    }
  }
  if (actionRows.length) {
    await sb.from("daily_action_items").delete().eq("snapshot_date", todayStr).in("lm_id", [...lmIdByEmail.values()]);
    await sb.from("daily_action_items").insert(actionRows);
  }

  // recompute scores (also triggers gamification: streaks, tiers, achievements)
  for (let i = 13; i >= 0; i--) {
    await recomputeScores(daysAgo(today, i));
  }

  return NextResponse.json({
    ok: true,
    lms: PERSONAS.length,
    snapshots: snapshotRows.length,
    actions: actionRows.length,
  });
}
