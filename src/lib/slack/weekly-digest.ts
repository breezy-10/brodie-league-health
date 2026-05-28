import { createAdminClient } from "@/lib/supabase/admin";
import { ymd, daysAgo } from "@/lib/source-apps/util";
import { resolveLmSlackId, newWorkspaceCache } from "@/lib/slack/resolve";

/**
 * Sunday-night weekly recap, DMed to each LM via Slack.
 * Compares last 7 days to the prior 7 to show momentum + names
 * one best metric + one biggest miss so the LM walks into Monday clear.
 */
export async function sendWeeklySlackDigest(date?: Date) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return { sent: 0, error: "SLACK_BOT_TOKEN missing" };
  const sb = createAdminClient();
  const now = date ?? new Date();
  const todayStr = ymd(now);
  const sevenAgo = ymd(daysAgo(now, 7));
  const fourteenAgo = ymd(daysAgo(now, 14));

  const { data: lms } = await sb
    .from("league_managers")
    .select("id, email, full_name, slack_user_id, tier, current_streak, avg_30d")
    .eq("active", true);

  const lmList = (lms ?? []) as Array<{
    id: string; email: string; full_name: string;
    slack_user_id: string | null; tier: string | null;
    current_streak: number | null; avg_30d: number | null;
  }>;

  // Auto-resolve missing slack ids — email lookup + name fallback
  const cache = newWorkspaceCache();
  for (const lm of lmList) {
    if (lm.slack_user_id) continue;
    const id = await resolveLmSlackId(token, lm, cache);
    if (id) lm.slack_user_id = id;
  }

  // Pull 14d of totals + breakdowns once
  const lmIds = lmList.map((l) => l.id);
  const { data: trend } = await sb
    .from("lm_xp_totals")
    .select("lm_id, snapshot_date, total_xp, pct, breakdown")
    .in("lm_id", lmIds)
    .gte("snapshot_date", fourteenAgo)
    .lte("snapshot_date", todayStr);

  type Row = { lm_id: string; snapshot_date: string; total_xp: number; pct: number; breakdown: Record<string, { score: number; max: number }> };
  const trendByLm = new Map<string, Row[]>();
  for (const r of (trend ?? []) as Row[]) {
    if (!trendByLm.has(r.lm_id)) trendByLm.set(r.lm_id, []);
    trendByLm.get(r.lm_id)!.push(r);
  }

  let sent = 0;
  const errors: string[] = [];

  for (const lm of lmList) {
    if (!lm.slack_user_id) continue;
    const rows = trendByLm.get(lm.id) ?? [];
    const last7 = rows.filter((r) => r.snapshot_date >= sevenAgo);
    const prior7 = rows.filter((r) => r.snapshot_date < sevenAgo);
    if (!last7.length) continue;

    const weekXp = last7.reduce((s, r) => s + Number(r.total_xp), 0);
    const priorXp = prior7.reduce((s, r) => s + Number(r.total_xp), 0);
    const delta = weekXp - priorXp;
    const last7Avg = last7.reduce((s, r) => s + Number(r.pct), 0) / last7.length;

    // Best/worst app last 7d
    const appAgg = new Map<string, { score: number; max: number }>();
    for (const r of last7) {
      for (const [slug, v] of Object.entries(r.breakdown ?? {})) {
        const cur = appAgg.get(slug) ?? { score: 0, max: 0 };
        cur.score += Number(v.score);
        cur.max += Number(v.max);
        appAgg.set(slug, cur);
      }
    }
    const appPcts = [...appAgg.entries()]
      .map(([slug, v]) => ({ slug, pct: v.max > 0 ? (v.score / v.max) * 100 : 0, score: v.score }))
      .sort((a, b) => b.pct - a.pct);
    const bestApp = appPcts[0];
    const worstApp = [...appPcts].sort((a, b) => a.pct - b.pct)[0];

    const firstName = (lm.full_name ?? lm.email).split(" ")[0];
    const arrow = delta > 0 ? "▲" : delta < 0 ? "▼" : "·";
    const deltaWord = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
    const headline =
      `*Hey ${firstName}, your week in review.*\n\n` +
      `XP last 7d: *${Math.round(weekXp)}* (${arrow} ${deltaWord} ${Math.abs(Math.round(delta))} vs prior week)\n` +
      `Daily avg: ${Math.round(last7Avg)}% · 30-day avg: ${Math.round(Number(lm.avg_30d ?? 0))}%\n` +
      (lm.current_streak ? `Current streak: 🔥 ${lm.current_streak} day${lm.current_streak === 1 ? "" : "s"}\n` : "") +
      `\n` +
      (bestApp ? `*Best app:* ${appLabel(bestApp.slug)} (${Math.round(bestApp.pct)}%)\n` : "") +
      (worstApp && worstApp.slug !== bestApp?.slug ? `*Needs work:* ${appLabel(worstApp.slug)} (${Math.round(worstApp.pct)}%)\n` : "") +
      `\n` +
      `Monday lands tomorrow. Open the board: ${process.env.NEXT_PUBLIC_SITE_URL ?? "https://brodie-league-health.vercel.app"}`;

    try {
      const res = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ channel: lm.slack_user_id, text: headline, mrkdwn: true }),
      });
      const j = (await res.json()) as { ok: boolean; error?: string };
      if (j.ok) sent++;
      else errors.push(`${lm.email}: ${j.error}`);
    } catch (e: unknown) {
      errors.push(`${lm.email}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { sent, errors };
}

function appLabel(slug: string): string {
  return ({
    crm: "Brodie CRM",
    facilities: "Facilities",
    ref_payroll: "Ref Payroll",
    training: "Training",
    stats_health: "Stats Health",
    content_health: "Content Health",
    checklist: "Seasonal Checklist",
    ops_schedule: "Ops Schedule",
    ramp: "Ramp Credit",
  } as Record<string, string>)[slug] ?? slug;
}
