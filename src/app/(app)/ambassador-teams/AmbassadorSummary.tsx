import { locParam } from "@/lib/seasons";
import { promoFetch } from "@/lib/promo-feed";
import { ChipTile as Tile, CHIP_STYLE } from "../dashboard/ChipTile";
import type { JoinedVia } from "@/components/TeamRosterBlock";

// The Promo Tracker owns the ops-DB (Metabase) connection, so the ambassador
// roster comes from its feed rather than being re-derived here — same pattern
// as the Registrations and Referrals tabs. Overridable so a local dev server
// can point at a local promo tracker.
const PROMO_APP_URL = process.env.PROMO_APP_URL ?? "https://registration-promo-tracker.vercel.app";

export type RosterEntry = {
  player: string;
  is_captain: boolean;
  paid: number;
  total: number;
  currency: string | null;
  paid_completed_at: string | null;
  paid_ok: boolean;
  // The discount on their registration and the code's name (the feed carries
  // both; optional for an older one).
  discount?: number;
  discount_names?: string | null;
  no_registration: boolean;
  // How they got onto this team (absent from an older feed); see JoinedVia.
  joined_via?: JoinedVia;
};
export type TeamRow = {
  team: string;
  roster?: RosterEntry[];
  captain: string | null;
  // Ops player id. Two captains can share a name, so this is what groups a
  // person's teams under their row on the board.
  captain_id?: string | null;
  day: string | null;
  division: string | null;
  players: number;
};
export type LocationRow = {
  location: string;
  teams: number;
  players: number;
  // Nights with an ambassador team.
  nights: number;
  // Every night the location plays this season, Monday first, ambassador team
  // or not. Absent from an older feed.
  days?: string[];
  // The divisions open on each night (absent from an older feed), so one with
  // no ambassador team can be named.
  divisions?: { day: string; division: string }[];
  rows: TeamRow[];
};
export type AmbassadorFeed = {
  season: string;
  totals: {
    teams: number;
    players: number;
    locations: number;
    captains: number;
    captain_only: number;
    no_roster: number;
    no_captain: number;
    max_roster: number;
    // Teams with 7+ players and with 3 or fewer, captain included.
    full_roster?: number;
    three_or_fewer?: number;
  };
  captain_teams: Record<string, number>;
  captain_players?: Record<string, number>;
  // Keyed by ops player id. Covers every captain, not just repeat ones.
  captains?: Record<string,
    { name: string; teams: number; full_roster?: number; players: number; teammates?: number; paid_teammates?: number }>;
  by_day: { day: string; teams: number; players: number }[];
  locations: LocationRow[];
  // Locations in scope with a captain this season but no ambassador team.
  // Null when the Promo Tracker couldn't tell.
  locations_without_ambassador?: string[] | null;
  // Each night a location in scope plays with no ambassador team on it, at
  // locations that cover some nights and at ones that cover none. A null day
  // is a location with captains but no known night.
  nights_without_ambassador?: { location: string; day: string | null }[] | null;
};

export async function loadAmbassadorTeams(
  season: string,
  locationNames: string[] | null,
): Promise<AmbassadorFeed | null> {
  try {
    const url = new URL("/api/ambassador-teams", PROMO_APP_URL);
    url.searchParams.set("season", season);
    const lp = locParam(locationNames);
    if (lp) url.searchParams.set("location", lp);
    const res = await promoFetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as AmbassadorFeed;
    return k.locations ? k : null;
  } catch {
    return null;
  }
}

const GOLD = "var(--glass-gold)";

// The Ambassador teams and Locations cards: the top of the Ambassador teams
// page, and the Ambassador teams section of the dashboard.
export function AmbassadorSummaryTiles({ feed }: { feed: AmbassadorFeed }) {
  const t = feed.totals;
  // Location-nights with no ambassador team ("Burlington Monday"). Undefined
  // from an older feed and null when the Promo Tracker couldn't tell; either
  // way no chips.
  const missing = feed.nights_without_ambassador ?? null;
  const missingLocations = new Set((missing ?? []).map((m) => m.location)).size;
  return (
    <>
      <Tile
        label="Ambassador teams"
        value={t.teams.toLocaleString()}
        accent={GOLD}
        chips={t.full_roster != null && t.three_or_fewer != null
          ? [
              { text: `${t.full_roster.toLocaleString()} with 7 or more players`, tone: "yellow" },
              { text: `${t.three_or_fewer.toLocaleString()} with 3 or fewer players`, tone: "red" },
            ]
          : undefined}
        stackChips
        // Players placed belongs with the teams they're placed on: the
        // count, and how many that comes to per team.
        // A second figure in the same card, set like the first: its
        // label, the number at the card's size, then per team.
        footer={
          <div className="mt-5">
            <div className="text-xs font-bold text-glass-text-tertiary truncate">Players placed</div>
            <div className="mt-1.5 text-2xl font-bold tabular leading-tight" style={{ color: "var(--glass-text)" }}>
              {t.players.toLocaleString()}
            </div>
            {t.teams > 0 && (
              <span className="mt-2 inline-block text-[11px] font-semibold rounded-full px-2 py-0.5 tabular" style={CHIP_STYLE.neutral}>
                {(t.players / t.teams).toFixed(2)} per team
              </span>
            )}
          </div>
        }
      />
      <Tile
        label="Locations"
        value={t.locations.toLocaleString()}
        sub={missing
          ? (missing.length
              ? `${missing.length} ${missing.length === 1 ? "night" : "nights"} at ${missingLocations} ${missingLocations === 1 ? "location" : "locations"} with no ambassador team`
              : "every night has an ambassador team")
          : undefined}
        chips={missing?.map((m) => ({ text: m.day ? `${m.location} ${m.day}` : m.location, tone: "red" as const }))}
      />
    </>
  );
}
