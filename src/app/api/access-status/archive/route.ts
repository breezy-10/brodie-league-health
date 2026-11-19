import { timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/access-status/archive  { email: string, by: string }
//   -> { archived: true } | { archived: false, reason: "not_found" | "already_archived" }
//
// The Archive button on the Ops Hub's offboarding warning in
// #ops-apps-access-requests: someone's Brodie account was shut off and they can
// still get into League Health, so archive them here. `by` is the name of whoever
// clicked it in Slack. Server to server, bearer ACCESS_EVENTS_KEY (the same key
// as /api/access-status next door).
//
// Archiving is what "Archive user" on Settings > Users does (setUserArchived):
// ban the auth user so they can't sign in. Nothing else changes and nothing is
// deleted; "Reactivate user" lifts the ban. No Slack notice: this isn't an
// answer to an access request. Safe to repeat: a second call finds them
// already archived.

export const dynamic = "force-dynamic";

const PAGE = 1000;
// setUserArchived's ban: 100 years.
const ARCHIVE_BAN = "876000h";

function authorized(req: Request): boolean {
  const key = process.env.ACCESS_EVENTS_KEY?.trim();
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!key || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

const norm = (e: unknown) => String(e ?? "").trim().toLowerCase();
const looksLikeEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { email?: unknown; by?: unknown } | null;
  const email = norm(body?.email);
  if (!looksLikeEmail(email)) return NextResponse.json({ error: "invalid email" }, { status: 400 });
  const by = String(body?.by ?? "").trim() || "someone";
  try {
    const db = createAdminClient();
    // Matched by email the way /api/access-status reads them. Paged: a roster
    // can pass 1,000 rows, PostgREST's page size.
    const matches: { id: string; active: boolean | null }[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db.from("profiles").select("id, email, active").order("id").range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      for (const r of (data ?? []) as { id: string; email: string | null; active: boolean | null }[]) {
        if (norm(r.email) === email) matches.push({ id: r.id, active: r.active });
      }
      if (!data || data.length < PAGE) break;
    }
    if (matches.length === 0) return NextResponse.json({ archived: false, reason: "not_found" });

    // Same "can get in" rule as /api/access-status: profiles.active not false
    // and no ban in force on the auth user.
    const stillIn: string[] = [];
    for (const m of matches) {
      if (m.active === false) continue;
      const { data, error } = await db.auth.admin.getUserById(m.id);
      if (error) throw new Error(error.message);
      const bannedUntil = (data.user as { banned_until?: string | null } | null)?.banned_until;
      if (!bannedUntil || new Date(bannedUntil).getTime() <= Date.now()) stillIn.push(m.id);
    }
    if (stillIn.length === 0) return NextResponse.json({ archived: false, reason: "already_archived" });

    for (const id of stillIn) {
      const { error } = await db.auth.admin.updateUserById(id, { ban_duration: ARCHIVE_BAN });
      if (error) throw new Error(error.message);
    }
    console.info(`[access-status/archive] archived ${email} (${stillIn.length} account${stillIn.length === 1 ? "" : "s"}) for ${by} (via Slack offboarding alert)`);
    revalidatePath("/settings/users");
    return NextResponse.json({ archived: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
