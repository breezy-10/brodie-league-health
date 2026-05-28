/**
 * Resolve an LM's Slack user ID with two strategies + caching:
 *
 *   1. users.lookupByEmail (fast, exact match)
 *   2. users.list + match by full_name  (fallback for LMs whose Slack profile
 *      uses a personal email that differs from their CRM email)
 *
 * Many Brodie LMs sign up to Slack with personal emails (gmail, outlook,
 * etc.) so email-only resolution misses ~75% of the roster. Name-fallback
 * fixes that without requiring anyone to update profiles manually.
 *
 * The resolved ID is persisted back to league_managers.slack_user_id so
 * subsequent runs skip the API entirely.
 *
 * Pass a workspaceUsers param to share a single users.list payload across
 * many resolves in the same run (avoids hammering Slack).
 */
import { createAdminClient } from "@/lib/supabase/admin";

type SlackUser = {
  id: string;
  deleted?: boolean;
  is_bot?: boolean;
  real_name?: string;
  profile?: { display_name?: string; real_name?: string; email?: string };
};

export type WorkspaceUsers = { fetched: boolean; users: SlackUser[] };

/** Lazy cache of the full workspace user list. Pass this between resolve
 *  calls in the same batch so we only fetch users.list once. */
export function newWorkspaceCache(): WorkspaceUsers {
  return { fetched: false, users: [] };
}

async function fetchWorkspaceUsers(token: string, cache: WorkspaceUsers): Promise<SlackUser[]> {
  if (cache.fetched) return cache.users;
  const all: SlackUser[] = [];
  let cursor: string | undefined = undefined;
  for (let page = 0; page < 10; page++) {
    const url = new URL("https://slack.com/api/users.list");
    url.searchParams.set("limit", "500");
    if (cursor) url.searchParams.set("cursor", cursor);
    try {
      const r = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
      const j = (await r.json()) as {
        ok: boolean;
        members?: SlackUser[];
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
  return all;
}

async function lookupByEmail(token: string, email: string): Promise<string | null> {
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

function matchByName(users: SlackUser[], fullName: string): string | null {
  const want = fullName.toLowerCase().trim();
  if (!want) return null;
  const first = want.split(/\s+/)[0];
  const last = want.split(/\s+/).slice(-1)[0];
  for (const u of users) {
    if (u.deleted || u.is_bot) continue;
    const real = (u.real_name ?? u.profile?.real_name ?? "").toLowerCase();
    const display = (u.profile?.display_name ?? "").toLowerCase();
    // Require BOTH first and last name to match somewhere in real or display
    // name. Avoids false positives from common first names alone.
    if (
      (real.includes(first) || display.includes(first)) &&
      (real.includes(last) || display.includes(last))
    ) {
      return u.id;
    }
  }
  return null;
}

/**
 * Resolve `lm`'s Slack user ID. Persists the result to league_managers
 * on success so we don't repeat work.
 */
export async function resolveLmSlackId(
  token: string,
  lm: { id: string; email: string; full_name: string; slack_user_id: string | null },
  cache: WorkspaceUsers
): Promise<string | null> {
  if (lm.slack_user_id) return lm.slack_user_id;

  // Try email first — fastest, no list scan.
  let id = await lookupByEmail(token, lm.email);

  // Fall back to name match against the full workspace user list.
  if (!id) {
    const users = await fetchWorkspaceUsers(token, cache);
    id = matchByName(users, lm.full_name);
  }

  if (id) {
    try {
      const admin = createAdminClient();
      await admin.from("league_managers").update({ slack_user_id: id }).eq("id", lm.id);
    } catch {
      // Cache write failure is non-fatal; we still return the ID for this run.
    }
  }
  return id;
}
