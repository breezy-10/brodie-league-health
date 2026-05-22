import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * CSV roster upsert. Body: text/csv with header row:
 *   email,full_name,location_name,district,slack_user_id
 * Use this when the CRM managers sync isn't ready or as a one-off override.
 */
export async function POST(req: Request) {
  await requireRole(["dm", "super_admin"]);
  const csv = await req.text();
  if (!csv.trim()) return NextResponse.json({ error: "empty body" }, { status: 400 });

  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return NextResponse.json({ error: "need header + at least 1 row" }, { status: 400 });

  const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const required = ["email", "full_name"];
  for (const r of required) {
    if (!header.includes(r)) return NextResponse.json({ error: `missing column ${r}` }, { status: 400 });
  }

  const rows: Array<Record<string, string | boolean | null>> = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length !== header.length) continue;
    const r: Record<string, string> = {};
    header.forEach((h, idx) => (r[h] = cols[idx]));
    if (!r.email) continue;
    rows.push({
      email: r.email.toLowerCase(),
      full_name: r.full_name || null,
      location_name: r.location_name || null,
      district: r.district || null,
      slack_user_id: r.slack_user_id || null,
      active: true,
      updated_at: new Date().toISOString(),
    });
  }

  if (!rows.length) return NextResponse.json({ error: "no valid rows" }, { status: 400 });

  const sb = createAdminClient();
  const { error } = await sb.from("league_managers").upsert(rows, { onConflict: "email" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, upserted: rows.length });
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else cur += c;
    } else {
      if (c === ",") { out.push(cur); cur = ""; }
      else if (c === '"') { inQuotes = true; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}
