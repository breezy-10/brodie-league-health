import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { resolveLmSlackId, newWorkspaceCache } from "@/lib/slack/resolve";

/**
 * Find LMs who haven't been welcomed yet and Slack each one a friendly
 * intro DM. Marks welcome_sent_at on success so we never double-send.
 *
 * Designed to be called from the daily sync cron. No-op if SLACK_BOT_TOKEN
 * is missing.
 *
 * Returns the count of LMs Slacked this run.
 */
export async function welcomeNewLMs(): Promise<{ sent: number; skipped: number; error?: string }> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return { sent: 0, skipped: 0, error: "SLACK_BOT_TOKEN missing" };

  const sb = createAdminClient();
  const { data: pending } = await sb
    .from("league_managers")
    .select("id, email, full_name, location_name, slack_user_id")
    .eq("active", true)
    .is("welcome_sent_at", null)
    .limit(50);

  const rows = (pending ?? []) as Array<{
    id: string;
    email: string;
    full_name: string;
    location_name: string | null;
    slack_user_id: string | null;
  }>;
  if (rows.length === 0) return { sent: 0, skipped: 0 };

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://brodie-league-health.vercel.app";
  let sent = 0;
  let skipped = 0;
  const cache = newWorkspaceCache();

  for (const lm of rows) {
    const slackId = await resolveLmSlackId(token, lm, cache);
    if (!slackId) {
      // Don't mark welcome_sent_at — they'll get picked up next run when
      // (a) they've been invited to Slack or (b) we can look them up.
      skipped += 1;
      continue;
    }

    const firstName = (lm.full_name ?? "").split(" ")[0] || "there";
    const blocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `*Hey ${firstName} — welcome to League Health.*\n` +
            `It's a single page that shows your daily score across every Brodie app you already use. ` +
            `Your action items, your XP, your trajectory — pulled live, no new tool to log into.`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `*First time in, do these three things:*\n` +
            `1. Sign in with your @brodierec.com Google account.\n` +
            `2. Walk through the 4-step welcome tour (less than 60 seconds).\n` +
            `3. Set a personal goal % on your dashboard.`,
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Open League Health" },
            url: appUrl,
            style: "primary",
          },
        ],
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text:
              "The system is meant to be challenged. If a metric looks wrong, hit Dispute and your DM will review it. " +
              "Questions? Reply here.",
          },
        ],
      },
    ];

    const r = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        channel: slackId,
        blocks,
        text: `Welcome to League Health, ${firstName}.`,
      }),
    }).catch(() => null);

    const ok = r ? (await r.json().catch(() => ({}))).ok === true : false;
    if (!ok) {
      skipped += 1;
      continue;
    }

    await sb
      .from("league_managers")
      .update({ welcome_sent_at: new Date().toISOString() })
      .eq("id", lm.id);

    await logAudit({
      action: AUDIT_ACTIONS.WELCOME_SENT,
      targetType: "lm",
      targetId: lm.id,
      payload: { email: lm.email, location: lm.location_name },
    });

    sent += 1;
  }

  return { sent, skipped };
}

// (lookupSlackByEmail removed — resolveLmSlackId handles lookup + name fallback)
