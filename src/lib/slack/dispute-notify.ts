import { createAdminClient } from "@/lib/supabase/admin";
import { newWorkspaceCache } from "@/lib/slack/resolve";

/**
 * DM the LM's manager when a new dispute is filed. No-op if SLACK_BOT_TOKEN
 * is missing — we never want to block the LM's submission on Slack.
 *
 * If we can't figure out who their DM is (no reports_to mapping in CRM yet),
 * fall back to messaging the first super_admin we find.
 */
export async function notifyDmOfDispute(disputeId: string) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return;
  const admin = createAdminClient();

  const { data: d } = await admin
    .from("metric_disputes")
    .select(
      "id, lm_id, snapshot_date, reason, league_managers!inner(full_name, email, reports_to), metrics!inner(name, slug, apps!inner(name))"
    )
    .eq("id", disputeId)
    .maybeSingle();
  if (!d) return;

  const row = d as unknown as {
    id: string;
    lm_id: string;
    snapshot_date: string;
    reason: string;
    league_managers: { full_name: string; email: string; reports_to: string | null };
    metrics: { name: string; slug: string; apps: { name: string } };
  };

  // Resolve the DM's Slack ID. reports_to is the DM's email in CRM.
  const cache = newWorkspaceCache();
  let dmSlackId: string | null = null;
  let dmProfileId: string | null = null;
  if (row.league_managers.reports_to) {
    const { data: dmProfile } = await admin
      .from("profiles")
      .select("id, slack_user_id, email, full_name")
      .ilike("email", row.league_managers.reports_to)
      .maybeSingle();
    const dp = dmProfile as
      | { id: string; slack_user_id: string | null; email: string; full_name: string | null }
      | null;
    if (dp) {
      dmProfileId = dp.id;
      dmSlackId = dp.slack_user_id;
      if (!dmSlackId) {
        dmSlackId = await lookupSlackByEmail(token, dp.email);
        if (!dmSlackId && dp.full_name) {
          dmSlackId = await matchSlackByName(token, dp.full_name, cache);
        }
      }
    }
  }

  // Fallback: any super_admin profile.
  if (!dmSlackId) {
    const { data: admins } = await admin
      .from("profiles")
      .select("id, slack_user_id, email, full_name")
      .eq("role", "super_admin")
      .limit(5);
    for (const a of (admins ?? []) as Array<{
      id: string;
      slack_user_id: string | null;
      email: string;
      full_name: string | null;
    }>) {
      if (a.slack_user_id) {
        dmSlackId = a.slack_user_id;
        dmProfileId = a.id;
        break;
      }
      const id =
        (await lookupSlackByEmail(token, a.email)) ??
        (a.full_name ? await matchSlackByName(token, a.full_name, cache) : null);
      if (id) {
        dmSlackId = id;
        dmProfileId = a.id;
        break;
      }
    }
  }
  if (!dmSlackId) return;

  // Cache the resolution so we don't repeat the lookup.
  if (dmProfileId) {
    admin.from("profiles").update({ slack_user_id: dmSlackId }).eq("id", dmProfileId).then(() => {}, () => {});
  }

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://brodie-league-health.vercel.app";
  const link = `${base}/district/disputes`;

  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `*New score dispute filed*\n` +
          `*${row.league_managers.full_name}* flagged *${row.metrics.apps.name} — ${row.metrics.name}* for ${row.snapshot_date}.`,
      },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `> ${row.reason.slice(0, 500)}` },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Review in League Health" },
          url: link,
          style: "primary",
        },
      ],
    },
  ];

  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ channel: dmSlackId, blocks, text: "New score dispute filed" }),
  }).catch(() => {});
}

async function lookupSlackByEmail(token: string, email: string): Promise<string | null> {
  try {
    const r = await fetch(
      `https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`,
      { headers: { authorization: `Bearer ${token}` } }
    );
    const j = (await r.json()) as { ok: boolean; user?: { id: string } };
    if (j.ok && j.user?.id) return j.user.id;
  } catch {}
  return null;
}

/** Name-fallback for DMs whose Slack profile uses a personal email. */
async function matchSlackByName(
  token: string,
  fullName: string,
  cache: import("@/lib/slack/resolve").WorkspaceUsers
): Promise<string | null> {
  if (!cache.fetched) {
    const all: Array<{
      id: string;
      deleted?: boolean;
      is_bot?: boolean;
      real_name?: string;
      profile?: { display_name?: string };
    }> = [];
    let cursor: string | undefined;
    for (let p = 0; p < 10; p++) {
      const url = new URL("https://slack.com/api/users.list");
      url.searchParams.set("limit", "500");
      if (cursor) url.searchParams.set("cursor", cursor);
      try {
        const r = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
        const j = (await r.json()) as {
          ok: boolean;
          members?: typeof all;
          response_metadata?: { next_cursor?: string };
        };
        if (!j.ok || !j.members) break;
        all.push(...j.members);
        cursor = j.response_metadata?.next_cursor;
        if (!cursor) break;
      } catch {
        break;
      }
    }
    cache.users = all;
    cache.fetched = true;
  }
  const want = fullName.toLowerCase().trim();
  const first = want.split(/\s+/)[0];
  const last = want.split(/\s+/).slice(-1)[0];
  for (const u of cache.users) {
    if (u.deleted || u.is_bot) continue;
    const real = (u.real_name ?? "").toLowerCase();
    const display = (u.profile?.display_name ?? "").toLowerCase();
    if (
      (real.includes(first) || display.includes(first)) &&
      (real.includes(last) || display.includes(last))
    ) {
      return u.id;
    }
  }
  return null;
}
