import { canonicalLocation, csvParam, locParam } from "@/lib/seasons";
import { getCanonicalLocations } from "@/lib/districts-locations";
import { getActiveLocationKeys, onlyActive } from "@/lib/active-locations";
import Filters, { type FilterOptions } from "../dashboard/Filters";
import { BasisToggle } from "../dashboard/BasisToggle";
import { dayLabel, todayKey } from "../drop-ins/ScheduledDropIns";
import { requireUser } from "@/lib/auth";
import { promoFetch } from "@/lib/promo-feed";
import EventsTable, { type EventPerson } from "./EventsTable";
import { CheckinNote, pct } from "./events-ui";

// Events: open runs, Kicks of the Week, opening nights, beginner runs, all-star
// games and the rest, from the ops events platform via the Promo Tracker. For
// each, who's going, how many were new to Brodie, and how many of those went
// on to register for a season. Events aren't tied to one season (an open run
// sells the next season, an opening night starts the current one), so the page
// splits them into upcoming, live (on right now) and past instead of filtering
// by season.
const PROMO_APP_URL = process.env.PROMO_APP_URL ?? "https://registration-promo-tracker.vercel.app";

export type EventRow = {
  id: string;
  name: string;
  kind: string;
  status: string | null;
  is_private: boolean;
  starts_at: string | null; // the event's own local time, "YYYY-MM-DDTHH:MM"
  timezone: string;
  upcoming: boolean;
  // Started and not yet over, and when it ends, in its own local time (absent
  // from an older feed).
  live?: boolean;
  ends_at?: string | null;
  // Present when the request named a season.
  in_season?: boolean;
  venue: string | null;
  location: string;
  rsvps: number;
  going: number;
  cancelled: number;
  paid: number;
  new_players: number;
  converted: number;
  // Checked in at the door, and of those, with a confirmed RSVP (absent from
  // an older feed).
  checked_in?: number;
  checked_in_going?: number;
  // Of those checked in, how many were new to Brodie.
  checked_in_new?: number;
};

export async function loadEvents(locationNames: string[] | null, season?: string): Promise<EventRow[] | null> {
  try {
    const url = new URL("/api/events", PROMO_APP_URL);
    if (season) url.searchParams.set("season", season);
    const lp = locParam(locationNames);
    if (lp) url.searchParams.set("location", lp);
    const res = await promoFetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as { events?: EventRow[] };
    return Array.isArray(k.events) ? k.events : null;
  } catch {
    return null;
  }
}

// Each event's people by name, for the rows that open: events still to come,
// or those that have started (live and past), within the page's dates.
async function loadEventPeople(upcoming: boolean, from?: string, to?: string): Promise<{ people: EventPerson[]; truncated: boolean } | null> {
  try {
    const url = new URL("/api/events", PROMO_APP_URL);
    url.searchParams.set("view", "people");
    if (upcoming) url.searchParams.set("when", "upcoming");
    if (from) url.searchParams.set("from", from);
    if (to) url.searchParams.set("to", to);
    const res = await promoFetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as { people?: EventPerson[]; truncated?: boolean };
    return Array.isArray(k.people) ? { people: k.people, truncated: !!k.truncated } : null;
  } catch {
    return null;
  }
}

type EventsParams = { location?: string; when?: string; from?: string; to?: string; sort?: string };

export default async function EventsView({ searchParams }: { searchParams: Promise<EventsParams> }) {
  await requireUser();
  return <EventsBody searchParams={searchParams} />;
}

// The page itself, apart from the sign-in check.
export async function EventsBody({ searchParams }: { searchParams: Promise<EventsParams> }) {
  const { location: locationParam, when: whenParam, from: fromParam, to: toParam, sort: sortParam } = await searchParams;
  // The list runs by date unless asked to group it by location.
  const byLocation = sortParam === "location";
  // An optional date range, on the event's own local date ("YYYY-MM-DD").
  const isDay = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  const from = isDay(fromParam), to = isDay(toParam);
  const when = whenParam === "past" ? "past" : whenParam === "live" ? "live" : "upcoming";
  const past = when === "past";
  const live = when === "live";
  const selectedLocations = csvParam(locationParam).map(canonicalLocation);
  const locationNames = selectedLocations.length ? selectedLocations : null;

  // Locations with a captain this season or next, as every location filter
  // lists; events at a venue no league plays at still show under All.
  const [canonical, active, all, peopleFeed] = await Promise.all([
    getCanonicalLocations(),
    getActiveLocationKeys([]),
    loadEvents(locationNames),
    loadEventPeople(!past && !live, from, to),
  ]);
  const peopleByEvent = new Map<string, EventPerson[]>();
  for (const p of peopleFeed?.people ?? []) {
    if (!peopleByEvent.has(p.event_id)) peopleByEvent.set(p.event_id, []);
    peopleByEvent.get(p.event_id)!.push(p);
  }
  const options: FilterOptions = { seasons: [], locations: onlyActive(canonical, active, selectedLocations), dates: true };

  const events = (all ?? [])
    .filter((e) => (live ? e.live === true : past ? !e.upcoming && !e.live : e.upcoming))
    .filter((e) => {
      const day = e.starts_at?.slice(0, 10);
      if (!day) return !from && !to;
      return (!from || day >= from) && (!to || day <= to);
    })
    .sort((a, b) => {
      const x = a.starts_at ?? "", y = b.starts_at ?? "";
      // Past runs newest first, upcoming and live soonest first; by location
      // keeps that order within each location, A-Z.
      return (byLocation ? a.location.localeCompare(b.location) : 0) || (past ? y.localeCompare(x) : x.localeCompare(y));
    });
  // A section per day, or per location, in the order the list is sorted.
  const groups: { key: string; label: string; events: EventRow[] }[] = [];
  for (const e of events) {
    const day = e.starts_at?.slice(0, 10) ?? "";
    const key = byLocation ? e.location : day;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.events.push(e);
    else groups.push({
      key,
      label: byLocation ? e.location : `${day === todayKey() ? "Today · " : ""}${dayLabel(day)}`,
      events: [e],
    });
  }
  const sum = (k: keyof EventRow) => events.reduce((s, e) => s + ((e[k] as number) ?? 0), 0);
  const going = sum("going");
  const outcome = eventOutcomeTiles(events);
  const anyPaid = events.some((e) => e.paid > 0);
  // The filter bar rebuilds the query string, so it carries what it doesn't own.
  const keep: Record<string, string> = {
    ...(past ? { when: "past" } : live ? { when: "live" } : {}),
    ...(byLocation ? { sort: "location" } : {}),
  };
  // Who has been let in so far, for the events on right now.
  const checkedIn = sum("checked_in"), checkedInGoing = sum("checked_in_going"), checkedInNew = sum("checked_in_new");

  return (
    <main className="brodie-fade-in space-y-6">
      <Filters
        key={`${selectedLocations.join(",")}|${from ?? ""}|${to ?? ""}`}
        options={options}
        current={{ seasons: [], locations: selectedLocations, from, to }}
        keep={Object.keys(keep).length ? keep : undefined}
      />

      <BasisToggle
        param="when"
        value={when}
        options={[{ value: "upcoming", label: "Upcoming" }, { value: "live", label: "Live" }, { value: "past", label: "Past" }]}
      />

      {!all ? (
        <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary shadow-card">
          Events feed unavailable: the Promo Tracker didn&apos;t answer.
        </div>
      ) : (
        <>
          <div className={`grid gap-3 grid-cols-2 ${past || live ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
            <Tile label={past ? "Events held" : live ? "Live now" : "Upcoming events"} value={events.length.toLocaleString()} />
            {outcome.goingTile}
            {outcome.newTile}
            {live && (
              <Tile label="Checked in" value={checkedIn.toLocaleString()}
                sub={<CheckinNote going={going} checkedInGoing={checkedInGoing} checkedIn={checkedIn} checkedInNew={checkedInNew} />} />
            )}
            {past && outcome.becameTile}
          </div>

          {events.length === 0 ? (
            <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary shadow-card">
              {past ? "No past events in this scope." : live ? "No events on right now in this scope." : "No upcoming events in this scope."}
              {(from || to) && " Try widening the dates."}
            </div>
          ) : (
            <>
            <BasisToggle
              param="sort"
              value={byLocation ? "location" : "date"}
              options={[{ value: "date", label: "By date" }, { value: "location", label: "By location" }]}
            />
            {/* Each section's day (or location) heads its own card, with the
                card's Expand all beside it. */}
            {groups.map((g) => (
              <EventsTable key={g.key} title={g.label} events={g.events} past={past} live={live} anyPaid={anyPaid}
                people={Object.fromEntries(g.events.map((e) => [e.id, peopleByEvent.get(e.id) ?? []]))} />
            ))}
            {peopleFeed?.truncated && (
              <p className="text-xs" style={{ color: "var(--red)" }}>
                The ops database returned its row limit, so some of the older events&apos; names may be missing. Narrow the dates to see them.
              </p>
            )}
            </>
          )}
        </>
      )}

      <p className="text-xs text-glass-text-tertiary max-w-[80ch]">
        Events from the ops events platform. Going is everyone with a confirmed RSVP, each person once. New to Brodie
        means no roster spot and no completed season registration before they RSVP&apos;d; became registrations is
        those new players who completed a paid season registration after the event. Live is an event that has
        started and not yet ended; checked in is everyone the front table has let in so far. Times are the event&apos;s own
        local time. The type is read from the event&apos;s name.
      </p>
    </main>
  );
}

// The Going, New to Brodie and Became registrations tiles over a set of
// events, built here once for this page and for the dashboard's Events row,
// so the two read the same. Checked in is the dashboard's, over events
// already held.
export function eventOutcomeTiles(events: EventRow[]) {
  const sum = (k: keyof EventRow, of = events) => of.reduce((s, e) => s + ((e[k] as number) ?? 0), 0);
  const going = sum("going"), newPlayers = sum("new_players"), converted = sum("converted");
  // Who is missing is measured only on the events that checked anyone in:
  // before check-ins began, everyone going would read as not checked in.
  const checking = events.filter((e) => (e.checked_in ?? 0) > 0);
  return {
    goingTile: (
      <Tile label="Going" value={going.toLocaleString()}
        sub={`${sum("rsvps").toLocaleString()} RSVPs · ${sum("cancelled").toLocaleString()} cancelled`} />
    ),
    newTile: (
      <Tile label="New to Brodie" value={newPlayers.toLocaleString()}
        sub={`${pct(newPlayers, going)} of those going had never played`} />
    ),
    becameTile: (
      <Tile label="Became registrations" value={pct(converted, newPlayers)}
        sub={`${converted.toLocaleString()} of ${newPlayers.toLocaleString()} new players registered for a season after`} />
    ),
    checkedInTile: (
      <Tile label="Checked in" value={sum("checked_in").toLocaleString()}
        sub={
          <>
            <span className="block">at {checking.length.toLocaleString()} of {events.length.toLocaleString()} events held</span>
            {checking.length > 0 && (
              <CheckinNote going={sum("going", checking)} checkedInGoing={sum("checked_in_going", checking)}
                checkedIn={sum("checked_in", checking)}
                checkedInNew={checking.some((e) => e.checked_in_new !== undefined) ? sum("checked_in_new", checking) : undefined} />
            )}
          </>
        } />
    ),
  };
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-glass-surface px-4 py-3.5 min-w-0 flex flex-col shadow-card">
      <div className="text-xs font-bold text-glass-text-tertiary truncate">{label}</div>
      <div className="mt-1.5 text-2xl font-bold tabular leading-tight" style={{ color: "var(--glass-text)" }}>{value}</div>
      {sub && <div className="text-[11px] text-glass-text-tertiary mt-1 leading-snug">{sub}</div>}
    </div>
  );
}
