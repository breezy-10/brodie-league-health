import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

// Signed-in proxy to the Promo Tracker's /api/team-roster, which owns the
// ops-DB connection. The discount drill-down calls this from the browser when
// a row is opened, so rosters load one team at a time instead of all at once.
const PROMO_APP_URL = process.env.PROMO_APP_URL ?? "https://registration-promo-tracker.vercel.app";

export async function GET(req: Request) {
  await requireUser();
  const inUrl = new URL(req.url);
  const url = new URL("/api/team-roster", PROMO_APP_URL);
  for (const k of ["season", "season_team_id", "player_id"]) {
    const v = inUrl.searchParams.get(k);
    if (v) url.searchParams.set(k, v);
  }
  try {
    const res = await fetch(url.toString(), { cache: "no-store" });
    const body = await res.json();
    return NextResponse.json(body, { status: res.status, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Promo Tracker unavailable" }, { status: 502 });
  }
}
