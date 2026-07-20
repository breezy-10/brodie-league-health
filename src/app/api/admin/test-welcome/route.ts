import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";

/**
 * Admin-only preview of the new-LM welcome DM. Sends the exact message
 * welcomeNewLMs() would send, but to a specific email, and WITHOUT
 * updating welcome_sent_at on any LM row. Use this to test the message
 * lands cleanly in Slack before letting the daily cron blast the roster.
 *
 *   POST /api/admin/test-welcome
 *   body: { email: "amy@brodierec.com", firstName?: "Amy" }
 */
export async function POST(req: Request) {
  await requireRole(["super_admin"]);
  const { email, firstName } = (await req.json()) as { email: string; firstName?: string };

  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "SLACK_BOT_TOKEN not set in env." }, { status: 500 });
  }
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Pass a valid email." }, { status: 400 });
  }

  // Look up the user's Slack ID.
  const lookup = await fetch(
    `https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`,
    { headers: { authorization: `Bearer ${token}` } }
  );
  const lj = (await lookup.json().catch(() => ({}))) as {
    ok: boolean;
    user?: { id: string };
    error?: string;
  };
  if (!lj.ok || !lj.user?.id) {
    return NextResponse.json(
      { error: `Slack couldn't find that email. Reason: ${lj.error ?? "unknown"}` },
      { status: 404 }
    );
  }

  const first = firstName?.trim() || email.split("@")[0];
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://brodie-league-health.vercel.app";

  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `*Hey ${first} — welcome to League Health.*\n` +
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
            "Questions? Reply here. _(This is a preview send — no LM rows were modified.)_",
        },
      ],
    },
  ];

  const post = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      channel: lj.user.id,
      blocks,
      text: `Welcome to League Health, ${first}.`,
    }),
  });
  const pj = (await post.json().catch(() => ({}))) as { ok: boolean; error?: string };
  if (!pj.ok) {
    return NextResponse.json(
      { error: `Slack rejected the message. Reason: ${pj.error ?? "unknown"}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, sent_to: email, slack_user_id: lj.user.id });
}
