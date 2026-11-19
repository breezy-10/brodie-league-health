import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/access-status  { emails: string[] }  ->  { active: string[] }
//
// The Ops Hub asks this when someone's Brodie account is shut off (suspended
// or archived in Google Workspace, or deactivated in Slack): which of these
// people can still get into League Health? Anyone who can is listed in the hub's
// warning in #ops-apps-access-requests, with a link to archive them here.
// Bearer ACCESS_EVENTS_KEY, the key this app already uses to report access
// requests to the hub. Read-only.

export const dynamic = "force-dynamic";

const PAGE = 1000;

function authorized(req: Request): boolean {
  const key = process.env.ACCESS_EVENTS_KEY?.trim();
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!key || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

const norm = (e: unknown) => String(e ?? "").trim().toLowerCase();

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { emails?: unknown } | null;
  const wanted = new Set((Array.isArray(body?.emails) ? body.emails : []).map(norm).filter(Boolean));
  if (wanted.size > 5000) return NextResponse.json({ error: "too many emails" }, { status: 400 });
  if (wanted.size === 0) return NextResponse.json({ active: [] });
  try {
    const active = await stillIn(wanted);
    return NextResponse.json({ active: [...active].sort() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

// Signing in needs profiles.active not false, and archiving bans the sign-in
// itself (no column), so a match is checked against its auth user too.
async function stillIn(wanted: Set<string>): Promise<Set<string>> {
  const db = createAdminClient();
  const matches: { id: string; email: string }[] = [];
  // Paged: a roster can pass 1,000 rows, PostgREST's page size.
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from("profiles").select("id, email, active").order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as { id: string; email: string | null; active: boolean | null }[]) {
      const email = norm(r.email);
      if (wanted.has(email) && r.active !== false) matches.push({ id: r.id, email });
    }
    if (!data || data.length < PAGE) break;
  }
  const out = new Set<string>();
  for (const m of matches) {
    const { data, error } = await db.auth.admin.getUserById(m.id);
    if (error) throw new Error(error.message);
    const bannedUntil = (data.user as { banned_until?: string | null } | null)?.banned_until;
    if (!bannedUntil || new Date(bannedUntil).getTime() <= Date.now()) out.add(m.email);
  }
  return out;
}
