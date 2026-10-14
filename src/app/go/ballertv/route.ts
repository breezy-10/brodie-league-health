import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { ballerTvUrl } from "@/lib/ballertv";
import { sourceClient, sourceConfigured } from "@/lib/source-apps/clients";

// The BallerTV link on the dashboard's live games. Resolved on click, so the
// dashboard never waits on ballertv.com: finds the game's stream in the
// league-season's BallerTV event by teams and start time, else opens the
// event's games, else a BallerTV search.
//
// ?location=Vaughan&at=2026-10-13T20:00&tz=America/New_York&home=...&away=...
// `at` is the venue's own wall-clock time, as the schedule stores it.

// A local wall-clock time in a zone, as an ISO instant.
function localToIso(local: string, tz: string): string | null {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).formatToParts(new Date(guess));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const shown = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
    return new Date(guess - (shown - guess)).toISOString();
  } catch {
    return null;
  }
}

// BallerTV events are named for the season as Stats Health spells it
// ("Fall 2026"): the season whose dates hold the game.
async function seasonFor(date: string): Promise<string | null> {
  if (!sourceConfigured("stats_health")) return null;
  const { data } = await sourceClient("stats_health")!.from("seasons").select("name, start_date, end_date");
  const hit = ((data ?? []) as { name: string | null; start_date: string | null; end_date: string | null }[])
    .find((s) => s.name && s.start_date && s.end_date && s.start_date <= date && date <= s.end_date);
  return hit?.name ?? null;
}

export async function GET(req: NextRequest) {
  const ctx = await getCurrentUser();
  if (!ctx?.user) return NextResponse.redirect(new URL("/login", req.url));

  const q = req.nextUrl.searchParams;
  const location = (q.get("location") ?? "").trim();
  const at = q.get("at") ?? "";
  const tz = q.get("tz") || "America/New_York";
  const gameDate = at.slice(0, 10);
  if (!location || !/^\d{4}-\d{2}-\d{2}$/.test(gameDate)) return NextResponse.redirect("https://www.ballertv.com/");

  const season = await seasonFor(gameDate).catch(() => null);
  const search = `https://www.ballertv.com/events?q=${encodeURIComponent(`Brodie ${location}${season ? ` ${season}` : ""}`)}`;
  if (!season) return NextResponse.redirect(search);
  try {
    const url = await ballerTvUrl({
      location,
      season,
      gameDate,
      scheduledAt: localToIso(at, tz),
      home: q.get("home") || null,
      away: q.get("away") || null,
    });
    return NextResponse.redirect(url);
  } catch {
    return NextResponse.redirect(search);
  }
}
