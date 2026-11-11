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

// The Ambassador teams, Players placed, Locations and Divisions cards: the
// top of the Ambassador teams page, and the Ambassador teams section of the
// dashboard.
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
  // How the players placed got onto their team, from each roster line's
  // joined_via (absent from an older feed: no breakdown then). Free agents
  // registered as free agents: they picked the team in the sign-up or staff
  // placed them. Joined directly is a team registration, with the captain's
  // code or invite or without one. Captains count as captains however they
  // registered.
  const roster = feed.locations.flatMap((l) => l.rows.flatMap((r) => r.roster ?? []));
  const knowsJoin = roster.some((p) => p.joined_via !== undefined);
  const joinCount = (test: (p: RosterEntry) => boolean) => roster.filter((p) => !p.is_captain && test(p)).length;
  const join = {
    captains: roster.filter((p) => p.is_captain).length,
    picked: joinCount((p) => p.joined_via === "free_agent_picked" || p.joined_via === "free_agent"),
    placed: joinCount((p) => p.joined_via === "free_agent_placed"),
    code: joinCount((p) => p.joined_via === "team_code"),
    noCode: joinCount((p) => p.joined_via === "no_code"),
    moved: joinCount((p) => p.joined_via === "moved"),
    noReg: joinCount((p) => p.joined_via == null),
  };
  const teamsByLocation = feed.locations.filter((l) => l.teams > 0)
    .sort((a, b) => b.teams - a.teams || a.location.localeCompare(b.location));
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
  // One chip per location, each day with its uncovered divisions (Sohaib,
  // Nov 10): "Burlington · Mon D3, D5 · Wed D4". A division goes by its
  // short name ("D3" for "D3 | Inter") unless another division open that day
  // shares it, then in full: "D4 Co-Ed" beside "D4 Rec", "D3 7pm-11pm".
  const shortDiv = (name: string) => name.split("|")[0].trim();
  const shortCount = new Map<string, number>();
  for (const d of openDivs) {
    const k = `${d.location}|${d.day}|${shortDiv(d.division)}`;
    shortCount.set(k, (shortCount.get(k) ?? 0) + 1);
  }
  const divLabel = (d: { location: string; day: string; division: string }) =>
    (shortCount.get(`${d.location}|${d.day}|${shortDiv(d.division)}`) ?? 0) > 1
      ? d.division.replace(/\s*\|\s*/, " ").trim()
      : shortDiv(d.division);
  // missingDivs is already in location, day, division order.
  const missingByLocation = new Map<string, Map<string, string[]>>();
  for (const d of missingDivs ?? []) {
    const days = missingByLocation.get(d.location) ?? new Map<string, string[]>();
    days.set(d.day, [...(days.get(d.day) ?? []), divLabel(d)]);
    missingByLocation.set(d.location, days);
  }
  const missingDivDayCount = [...missingByLocation.values()].reduce((n, days) => n + days.size, 0);
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
        // Every location with an ambassador team and how many it has, most
        // first, under the roster chips.
        footer={teamsByLocation.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {teamsByLocation.map((l) => (
              <span key={l.location} className="text-[11px] font-semibold rounded-full px-2 py-0.5 tabular sm:whitespace-nowrap"
                style={CHIP_STYLE.neutral}>
                {l.location} {l.teams.toLocaleString()}
              </span>
            ))}
          </div>
        )}
      />
      {/* Players placed on those teams, and how many that comes to per team. */}
      <Tile
        label="Players placed"
        value={t.players.toLocaleString()}
        stackChips
        chips={[
          ...(t.teams > 0 ? [{ text: `${(t.players / t.teams).toFixed(2)} per team`, tone: "neutral" as const }] : []),
          ...(knowsJoin ? [
            { text: `${(join.picked + join.placed).toLocaleString()} free agents (${join.picked.toLocaleString()} picked the team, ${join.placed.toLocaleString()} placed by staff)`, tone: "neutral" as const, wrap: true },
            { text: `${(join.code + join.noCode).toLocaleString()} joined the team directly (${join.code.toLocaleString()} with the captain's code, ${join.noCode.toLocaleString()} without)`, tone: "neutral" as const, wrap: true },
            { text: `${join.captains.toLocaleString()} captains`, tone: "neutral" as const },
            ...(join.moved ? [{ text: `${join.moved.toLocaleString()} moved here by staff`, tone: "neutral" as const }] : []),
            ...(join.noReg ? [{ text: `${join.noReg.toLocaleString()} with no registration`, tone: "neutral" as const }] : []),
          ] : []),
        ]}
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
              ? `${missingDivs.length} ${missingDivs.length === 1 ? "division" : "divisions"} on ${missingDivDayCount} ${missingDivDayCount === 1 ? "day" : "days"} at ${missingDivLocations} ${missingDivLocations === 1 ? "location" : "locations"} with no ambassador team`
              : "every division has an ambassador team")
          : undefined}
        chips={missingDivs ? [...missingByLocation].map(([location, days]) => ({
          text: [location, ...[...days].map(([day, divs]) => `${day.slice(0, 3)} ${divs.join(", ")}`)].join(" \u00B7 "),
          tone: "red" as const, href: portalHref(location), wrap: true,
        })) : undefined}
      />
    </>
  );
}
