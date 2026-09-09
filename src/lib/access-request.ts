// Self-contained access request notifier.
//
// This app owns its own roster, so a locked-out person asks here and the Slack
// DM names THIS app. Nothing routes through the Ops Hub - that indirection is
// what made requests show up as "Ops Hub access requested".

const APP_NAME = "League Health";
const APP_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://brodie-league-health.vercel.app";

export async function notifyAccessRequested(input: {
  email: string;
  fullName?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.SLACK_BOT_TOKEN;
  const userId = process.env.SLACK_ACCESS_REQUEST_USER_ID;
  if (!token || !userId) {
    console.warn("[access-request] SLACK_BOT_TOKEN / SLACK_ACCESS_REQUEST_USER_ID not set");
    return { ok: false, error: "slack_not_configured" };
  }

  const who = input.fullName?.trim() || input.email;
  const usersUrl = `${APP_URL}/settings/users`;

  try {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        channel: userId,
        text: `${who} (${input.email}) is asking for access to ${APP_NAME} - ${usersUrl}`,
        blocks: [
          {
            type: "header",
            text: { type: "plain_text", text: `Access requested - ${APP_NAME}`, emoji: true },
          },
          {
            type: "section",
            fields: [
              { type: "mrkdwn", text: `*Who*\n${who}` },
              { type: "mrkdwn", text: `*Email*\n${input.email}` },
            ],
          },
          {
            type: "section",
            text: { type: "mrkdwn", text: `Invite them in <${usersUrl}|Settings -> Users>.` },
          },
        ],
      }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!data.ok) {
      console.error("[access-request] slack error:", data.error);
      return { ok: false, error: data.error || "slack_failed" };
    }
    return { ok: true };
  } catch (err) {
    console.error("[access-request] slack threw:", err);
    return { ok: false, error: "slack_unreachable" };
  }
}
