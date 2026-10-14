import "server-only";
import { readAppSecret } from "@/lib/app-secrets";

// Teams one no-show from forfeiting: 6 or fewer fully paid players. Read from
// the overdue app's own feed, so the teams here are the teams on its Teams
// board. It answers League Health's feed key (LEAGUE_HEALTH_FEED_KEY there),
// from the environment if set, else League Health's app_secrets table, and
// leaves out who owes what: its board has that.
export const OVERDUE_APP_URL = "https://brodie-overdue-payments.vercel.app";

export type ForfeitTeam = {
  team_id: string;
  team_name: string;
  location: string;
  day: string | null;
  total_players: number;
  paid_players: number;
  unpaid_players: number;
  // Roster players who have played a completed game this season; null when
  // the overdue app couldn't tell.
  checked_in_players: number | null;
};

// Every location's at-risk teams for the season, most at risk first; null
// when the feed didn't answer. The feed is org-wide, so callers apply their
// own location filter.
export async function loadForfeitRisk(season: string): Promise<ForfeitTeam[] | null> {
  try {
    const url = new URL("/api/all-forfeit-risk", OVERDUE_APP_URL);
    url.searchParams.set("season", season);
    const key = process.env.OVERDUE_FEED_KEY ?? (await readAppSecret("overdue_feed_key"));
    if (!key) return null;
    const res = await fetch(url, { cache: "no-store", headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) return null;
    const k = (await res.json()) as { teams?: ForfeitTeam[] };
    return Array.isArray(k.teams) ? k.teams : null;
  } catch {
    return null;
  }
}

// The overdue app's Teams board on the same season, and on one venue when
// given. It matches by exact name and has no multi-venue view, so anything
// wider opens the cross-location board.
export function forfeitTeamsHref(season: string, location: string | null = null): string {
  const u = new URL("/teams", OVERDUE_APP_URL);
  u.searchParams.set("season", season);
  if (location) u.searchParams.set("location", location);
  return u.toString();
}
