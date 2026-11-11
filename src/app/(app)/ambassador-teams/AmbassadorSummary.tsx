import { locParam, seasonKey } from "@/lib/seasons";
import { canonLoc, sameLocation } from "@/lib/location-match";
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

// Each location's page in the Player Portal for a season, so a location with
// no ambassador team opens where a player would sign up there. The portal's
// public seasons list gives each location's season target id (the reg target),
// and ?season_target= on the free agent page opens it on that location and
// season, its divisions and their teams listed (checked Nov 10 on Atlanta
// (Chamblee), Winter '27). Only seasons open in the portal are listed; null
// when it couldn't be read, and a location it doesn't list gets no link.
const PORTAL_SEASONS_URL = "https://api.brodierec.dev/portal/register/seasons";
const PORTAL_LOCATION_URL = "https://athletes.brodierec.com/registrations/new/free-agent/league-details";
export async function loadPortalLinks(season: string): Promise<Map<string, string> | null> {
  try {
    const res = await promoFetch(PORTAL_SEASONS_URL);
    if (!res.ok) return null;
    const k = (await res.json()) as { data?: { id: string; name: string; campaign_name: string | null }[] };
    const links = new Map<string, string>();
    for (const x of k.data ?? []) {
      if (x.campaign_name && seasonKey(x.campaign_name) === seasonKey(season)) {
        links.set(canonLoc(x.name), `${PORTAL_LOCATION_URL}?${new URLSearchParams({ season_target: x.id })}`);
      }
    }
    return links;
  } catch {
    return null;
  }
}

const GOLD = "var(--glass-gold)";

// The Ambassador teams, Locations and Divisions cards: the top of the
// Ambassador teams page, and the Ambassador teams section of the dashboard.
// portal: each location's Player Portal page (loadPortalLinks), so the red
// chips open the location's sign-up page.
export function AmbassadorSummaryTiles({ feed, portal }: { feed: AmbassadorFeed; portal?: Map<string, string> | null }) {
  // The portal names a single-venue market after its venue ("Atlanta
  // (Chamblee)" for Atlanta), so a name with no exact match takes the one
  // portal location it shares a first word with, never a guess between two.
  const portalHref = (location: string) => {
    if (!portal) return undefined;
    const exact = portal.get(canonLoc(location));
    if (exact) return exact;
    const near = [...portal.keys()].filter((k) => sameLocation(k, location));
    return near.length === 1 ? portal.get(near[0]) : undefined;
  };
  const t = feed.totals;
  // Location-nights with no ambassador team ("Burlington Monday"). Undefined
  // from an older feed and null when the Promo Tracker couldn't tell; either
  // way no chips.
  const missing = feed.nights_without_ambassador ?? null;
  const missingLocations = new Set((missing ?? []).map((m) => m.location)).size;
  // Divisions the same way: each location's divisions open on each day (its
  // registration campaign), and which have an ambassador team in them. Names
  // compared without case or stray spaces. No division list (an older feed,
  // or the Promo Tracker couldn't read it) means no list of the uncovered.
  const divKey = (location: string, day: string, division: string) =>
    `${location}|${day}|${division.trim().toLowerCase()}`;
  const coveredDivs = new Set(feed.locations.flatMap((l) => l.rows
    .filter((r) => r.day && r.division)
    .map((r) => divKey(l.location, r.day!, r.division!))));
  const openDivs = feed.locations.flatMap((l) => (l.divisions ?? []).map((d) => ({ location: l.location, ...d })));
  const dayOrder = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const missingDivs = openDivs.length
    ? openDivs.filter((d) => !coveredDivs.has(divKey(d.location, d.day, d.division)))
        .sort((a, b) => a.location.localeCompare(b.location) || dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day)
          || a.division.localeCompare(b.division))
    : null;
  const missingDivLocations = new Set((missingDivs ?? []).map((d) => d.location)).size;
  // One chip per location and day, its uncovered divisions by their short
  // name ("D3" for "D3 | Inter"): 106 single-division chips (Winter '27)
  // ran the card off the page.
  const shortDiv = (name: string) => name.split("|")[0].trim();
  const missingDivDays = new Map<string, { location: string; divs: string[] }>();
  for (const d of missingDivs ?? []) {
    const k = `${d.location} ${d.day}`;
    const cur = missingDivDays.get(k) ?? { location: d.location, divs: [] };
    cur.divs.push(shortDiv(d.division));
    missingDivDays.set(k, cur);
  }
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
        label="Locations with 1 or more ambassador teams"
        value={t.locations.toLocaleString()}
        sub={missing
          ? (missing.length
              ? `${missing.length} ${missing.length === 1 ? "day" : "days"} at ${missingLocations} ${missingLocations === 1 ? "location" : "locations"} with no ambassador team`
              : "every day has an ambassador team")
          : undefined}
        chips={missing?.map((m) => ({ text: m.day ? `${m.location} ${m.day}` : m.location, tone: "red" as const, href: portalHref(m.location) }))}
      />
      <Tile
        label="Divisions with 1 or more ambassador teams"
        value={coveredDivs.size.toLocaleString()}
        sub={missingDivs
          ? (missingDivs.length
              ? `${missingDivs.length} ${missingDivs.length === 1 ? "division" : "divisions"} on ${missingDivDays.size} ${missingDivDays.size === 1 ? "day" : "days"} at ${missingDivLocations} ${missingDivLocations === 1 ? "location" : "locations"} with no ambassador team`
              : "every division has an ambassador team")
          : undefined}
        chips={missingDivs ? [...missingDivDays].map(([where, d]) => ({ text: `${where} ${d.divs.join(", ")}`, tone: "red" as const, href: portalHref(d.location) })) : undefined}
      />
    </>
  );
}
