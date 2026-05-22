import { createAdminClient } from "@/lib/supabase/admin";
import { ymd } from "@/lib/source-apps/util";

async function lookupSlackByEmail(token: string, email: string): Promise<string | null> {
  try {
    const r = await fetch(`https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const j = (await r.json()) as { ok: boolean; user?: { id: string }; error?: string };
    if (j.ok && j.user?.id) return j.user.id;
  } catch {}
  return null;
}

export async function sendDailyDigest(date?: Date) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return { sent: 0, error: "SLACK_BOT_TOKEN missing" };
  const sb = createAdminClient();
  const dateStr = ymd(date ?? new Date());

  const { data: lms } = await sb
    .from("league_managers")
    .select("id, email, full_name, location_name, slack_user_id")
    .eq("active", true);

  // Auto-resolve missing slack_user_ids via Slack's users.lookupByEmail.
  for (const lm of ((lms ?? []) as Array<{ id: string; email: string; slack_user_id: string | null }>)) {
    if (lm.slack_user_id) continue;
    const id = await lookupSlackByEmail(token, lm.email);
    if (id) {
      await sb.from("league_managers").update({ slack_user_id: id }).eq("id", lm.id);
      lm.slack_user_id = id;
    }
  }

  const lmIds = (lms ?? []).map((l: { id: string }) => l.id);
  if (!lmIds.length) return { sent: 0 };

  const { data: xp } = await sb
    .from("lm_xp_totals")
    .select("lm_id, total_xp, max_xp, pct, rank_overall, breakdown")
    .eq("snapshot_date", dateStr);
  const xpByLm = new Map((xp ?? []).map((x: { lm_id: string }) => [x.lm_id, x]));

  const { data: actions } = await sb
    .from("daily_action_items")
    .select("lm_id, title, detail, severity, app_id")
    .eq("snapshot_date", dateStr)
    .is("resolved_at", null);

  const actionsByLm = new Map<string, Array<{ title: string; severity: string; detail: string | null }>>();
  for (const a of (actions ?? []) as Array<{ lm_id: string; title: string; severity: string; detail: string | null }>) {
    if (!actionsByLm.has(a.lm_id)) actionsByLm.set(a.lm_id, []);
    actionsByLm.get(a.lm_id)!.push(a);
  }

  const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  let sent = 0;
  const errors: string[] = [];

  for (const lm of (lms ?? []) as Array<{ id: string; email: string; full_name: string; location_name: string | null; slack_user_id: string | null }>) {
    if (!lm.slack_user_id) continue;
    const x = xpByLm.get(lm.id) as { total_xp?: number; max_xp?: number; pct?: number; rank_overall?: number; breakdown?: Record<string, { score: number; max: number }> } | undefined;
    const items = (actionsByLm.get(lm.id) ?? []).sort(
      (a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9)
    );

    const first = (lm.full_name || lm.email).split(" ")[0];
    const xpLine = x?.total_xp != null
      ? `*XP today:* ${Math.round(x.total_xp)} / ${Math.round(x.max_xp ?? 100)} (${Math.round(x.pct ?? 0)}%)${x.rank_overall ? ` — rank #${x.rank_overall}` : ""}`
      : "*XP today:* awaiting first sync.";

    const breakdownLine = x?.breakdown
      ? Object.entries(x.breakdown)
          .map(([slug, v]) => `${slug}: ${Math.round((v.score / Math.max(v.max, 1)) * 100)}%`)
          .join("  •  ")
      : "";

    let actionBlock = "";
    if (items.length === 0) {
      actionBlock = "*Today’s focus:* clean board. Keep stacking.";
    } else {
      actionBlock = `*Today’s focus (${items.length} item${items.length > 1 ? "s" : ""}):*\n` +
        items.slice(0, 6).map((i) => `• ${i.severity === "critical" ? "🚨" : i.severity === "high" ? "⚠️" : "•"} ${i.title}`).join("\n");
    }

    const text = `Good morning ${first}.\n\n${xpLine}\n${breakdownLine ? breakdownLine + "\n" : ""}\n${actionBlock}\n\nOpen the full board: ${process.env.NEXT_PUBLIC_SITE_URL ?? "https://brodie-league-health.vercel.app"}`;

    try {
      const res = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ channel: lm.slack_user_id, text, mrkdwn: true }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) errors.push(`${lm.email}: ${json.error}`);
      else sent++;
    } catch (e: unknown) {
      errors.push(`${lm.email}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { sent, errors };
}
