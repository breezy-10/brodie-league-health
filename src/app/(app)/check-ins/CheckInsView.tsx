import { canonicalLocation, csvParam, locParam, resolveScope } from "@/lib/seasons";
import Filters, { type FilterOptions } from "../dashboard/Filters";
import { BasisToggle } from "../dashboard/BasisToggle";
import { requireUser } from "@/lib/auth";
import { promoFetch } from "@/lib/promo-feed";
import { loadEvents, type EventRow } from "../events/EventsView";
import { dayLabel, todayKey } from "../drop-ins/ScheduledDropIns";
import { TZ_SHORT } from "@/lib/tz";

// Check-ins: the front table checks each player in at the door, to a game or
// to the venue, and at events. For every game night of the season, how many
// players were checked in against how many played, by location or night by
// night, and the same for events against who was going. The Promo Tracker
// owns the ops-DB connection, so the figures come from its feed.
const PROMO_APP_URL = process.env.PROMO_APP_URL ?? "https://registration-promo-tracker.vercel.app";

type Night = {
  league_id: string;
  location: string;
  night: string; // the venue's local date, "YYYY-MM-DD"
  games: number;
  games_stats_in?: number; // games whose stats are in; absent from an older feed
  played: number;
  checked_in: number;
  checked_and_played: number;
  staff: string[];
};

async function loadNights(season: string, locationNames: string[] | null): Promise<Night[] | null> {
  try {
    const url = new URL("/api/check-ins", PROMO_APP_URL);
    url.searchParams.set("season", season);
    const lp = locParam(locationNames);
    if (lp) url.searchParams.set("location", lp);
    const res = await promoFetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as { nights?: Night[] };
    return Array.isArray(k.nights) ? k.nights : null;
  } catch {
    return null;
  }
}

// The window opens on the first night two or more locations checked players
// in, which is when check-ins started for real: before it there was one test
// check-in at Burlington (Sep 28) and a trial at Toronto (Uptown) (Oct 14),
// and counting from those buried the rollout under weeks of nights nobody
// was asked to check in. From then on a location that has not started reads
// as nights missed rather than dropping out. A scoped view still needs every
// location's nights for that, so it reads the whole season too. Shared with
// the dashboard's Check-ins section, so the two give the same figures.
export async function loadCheckIns(season: string, locationNames: string[] | null): Promise<{
  connected: boolean; since: string | null; nights: Night[]; events: EventRow[] | null; shownEvents: EventRow[];
}> {
  const [scoped, everywhere, events] = await Promise.all([
    loadNights(season, locationNames),
    locationNames ? loadNights(season, null) : Promise.resolve(null),
    loadEvents(locationNames, season),
  ]);
  const all = everywhere ?? scoped;
  const locsByNight = new Map<string, number>();
  for (const n of all ?? []) if (n.checked_in > 0) locsByNight.set(n.night, (locsByNight.get(n.night) ?? 0) + 1);
  const since = [...locsByNight.entries()].filter(([, k]) => k >= 2).map(([d]) => d).sort()[0] ?? null;
  const nights = (scoped ?? []).filter((n) => since && n.night >= since);

  // Events already held this season from the first event check-in in scope
  // (or the first game night's, if that came first).
  const pastEvents = (events ?? []).filter((e) => !e.upcoming && e.in_season !== false && e.starts_at);
  const eventSince = [
    since,
    pastEvents.filter((e) => (e.checked_in ?? 0) > 0).map((e) => e.starts_at!.slice(0, 10)).sort()[0] ?? null,
  ].filter((d): d is string => !!d).sort()[0] ?? null;
  const shownEvents = pastEvents
    .filter((e) => eventSince && e.starts_at!.slice(0, 10) >= eventSince)
    .sort((a, b) => (b.starts_at ?? "").localeCompare(a.starts_at ?? ""));
  return { connected: scoped !== null, since, nights, events, shownEvents };
}

export const statsIn = (n: Night) => n.games_stats_in ?? n.games;

// The window's totals, and one row per location over it.
export function checkInTotals(nights: Night[]) {
  const sum = (rows: Night[], k: "games" | "played" | "checked_in" | "checked_and_played") =>
    rows.reduce((s, n) => s + n[k], 0);
  const games = sum(nights, "games");
  const gamesIn = nights.reduce((s, n) => s + statsIn(n), 0);
  const checkedIn = sum(nights, "checked_in");
  const played = sum(nights, "played");
  const checkedPlayed = sum(nights, "checked_and_played");
  const nightsChecking = nights.filter((n) => n.checked_in > 0).length;

  type LocRow = {
    location: string; nights: number; checking: number; games: number; gamesIn: number; played: number;
    checkedIn: number; checkedPlayed: number; last: string | null; staff: Set<string>;
  };
  const byLoc = new Map<string, LocRow>();
  for (const n of nights) {
    const r = byLoc.get(n.location) ?? {
      location: n.location, nights: 0, checking: 0, games: 0, gamesIn: 0, played: 0, checkedIn: 0, checkedPlayed: 0,
      last: null, staff: new Set<string>(),
    };
    r.nights += 1;
    r.games += n.games;
    r.gamesIn += statsIn(n);
    r.played += n.played;
    r.checkedIn += n.checked_in;
    r.checkedPlayed += n.checked_and_played;
    if (n.checked_in > 0) {
      r.checking += 1;
      if (!r.last || n.night > r.last) r.last = n.night;
    }
    for (const s of n.staff) r.staff.add(s);
    byLoc.set(n.location, r);
  }
  const locRows = [...byLoc.values()].sort((a, b) => a.location.localeCompare(b.location));
  const locsChecking = locRows.filter((r) => r.checking > 0).length;
  return { games, gamesIn, checkedIn, played, checkedPlayed, nightsChecking, locRows, locsChecking };
}

export const pct = (n: number, of: number) => (of ? `${Math.round((100 * n) / of)}%` : "—");
// Everyone who played checked in is the standard: all of them green, 80% and
// up yellow, below that red, as the dashboard reads a booking.
export function shareStyle(n: number, of: number): React.CSSProperties {
  const p = of ? n / of : 0;
  if (p >= 1) return { color: "var(--green)", background: "var(--green-tint)" };
  if (p >= 0.8) return { color: "var(--amber-ink)", background: "var(--amber-tint)" };
  return { color: "var(--red)", background: "var(--red-tint)" };
}
const CHIP = "inline-block text-[11px] font-semibold rounded-md px-1.5 py-0.5 whitespace-nowrap";
const GREY: React.CSSProperties = { color: "var(--glass-text-secondary)", background: "var(--fill-3)" };
const RED: React.CSSProperties = { color: "var(--red)", background: "var(--red-tint)" };

// "Thu, Oct 15" for a local date.
function shortDay(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

type CheckInsParams = { season?: string; location?: string; by?: string };

export default async function CheckInsView({ searchParams }: { searchParams: Promise<CheckInsParams> }) {
  await requireUser();
  const { season: seasonParam, location: locationParam, by: byParam } = await searchParams;
  const byNight = byParam === "night";
  const selectedSeasons = csvParam(seasonParam);
  const selectedLocations = csvParam(locationParam).map(canonicalLocation);

  // Check-ins happen at games being played, so this defaults to the playing
  // season, as Drop-ins does.
  const { filterLocations, promoSeasons, selectedSeason, locationNames } = await resolveScope(
    { season: selectedSeasons[0], locations: selectedLocations },
    { defaultSeason: "playing" },
  );
  const options: FilterOptions = {
    seasons: promoSeasons.map((s) => ({ value: s, label: s })),
    locations: filterLocations,
  };

  const data = await loadCheckIns(selectedSeason, locationNames);
  const scoped = data.connected;
  const { since, nights, events, shownEvents } = data;
  const { games, gamesIn, checkedIn, played, checkedPlayed, nightsChecking, locRows, locsChecking } = checkInTotals(nights);

  const nightGroups: { key: string; rows: Night[] }[] = [];
  for (const n of [...nights].sort((a, b) => b.night.localeCompare(a.night) || a.location.localeCompare(b.location))) {
    const g = nightGroups[nightGroups.length - 1];
    if (g && g.key === n.night) g.rows.push(n);
    else nightGroups.push({ key: n.night, rows: [n] });
  }
  const today = todayKey();
  const eventCheckedIn = shownEvents.reduce((s, e) => s + (e.checked_in ?? 0), 0);

  return (
    <main className="brodie-fade-in space-y-6">
      <Filters
        key={`${selectedSeasons.join(",")}|${selectedLocations.join(",")}`}
        options={options}
        current={{
          seasons: selectedSeasons.length ? selectedSeasons : [selectedSeason],
          locations: selectedLocations,
        }}
        keep={byNight ? { by: "night" } : undefined}
      />

      {!scoped ? (
        <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary shadow-card">
          Check-in feed unavailable: the Promo Tracker didn&apos;t answer for {selectedSeason}.
        </div>
      ) : !since ? (
        <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary shadow-card">
          Nobody has been checked in at a game night in {selectedSeason} yet.
        </div>
      ) : (
        <>
          <p className="text-sm text-glass-text-secondary">
            Counting from {dayLabel(since)}, the first night check-ins ran at more than one location this {selectedSeason}.
          </p>

          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Tile label="Players checked in" value={checkedIn.toLocaleString()}
              sub={`on ${nightsChecking.toLocaleString()} of ${nights.length.toLocaleString()} game nights`} />
            <Tile label="Of those who played" value={pct(checkedPlayed, played)}
              valueStyle={played ? { color: shareStyle(checkedPlayed, played).color } : undefined}
              sub={`${checkedPlayed.toLocaleString()} of ${played.toLocaleString()} players with a stat line were checked in${
                played && gamesIn < games ? `, with stats in for ${gamesIn.toLocaleString()} of ${games.toLocaleString()} games` : ""}`} />
            <Tile label="Locations checking in" value={`${locsChecking} of ${locRows.length}`}
              sub={locRows.length - locsChecking > 0
                ? `${locRows.length - locsChecking} with game nights and no one checked in`
                : "every location with a game night"} />
            <Tile label="Checked in at events" value={eventCheckedIn.toLocaleString()}
              sub={`at ${shownEvents.filter((e) => (e.checked_in ?? 0) > 0).length} of ${shownEvents.length} events held`} />
          </div>

          <section className="space-y-3">
            {/* The view toggle sits on its own row under the cards, above the
                section it switches. */}
            <BasisToggle
              param="by"
              value={byNight ? "night" : "location"}
              options={[{ value: "location", label: "By location" }, { value: "night", label: "By night" }]}
            />
            <h2 className="text-lg font-semibold" style={{ color: "var(--glass-text)" }}>
              {byNight ? "By night" : "By location"}
            </h2>

            {nights.length === 0 ? (
              <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary shadow-card">
                No game nights in this scope since {dayLabel(since)}.
              </div>
            ) : byNight ? (
              nightGroups.map((g) => (
                <section key={g.key} className="space-y-2">
                  <h3 className="text-sm font-semibold" style={{ color: "var(--glass-text)" }}>
                    {g.key === today ? "Today · " : ""}{dayLabel(g.key)}
                    <span className="ml-2 text-xs font-normal text-glass-text-tertiary">
                      {g.rows.length} {g.rows.length === 1 ? "location" : "locations"}
                    </span>
                  </h3>
                  <Table minWidth={820}>
                    <thead>
                      <tr className="text-xs font-bold text-glass-text-tertiary">
                        <Th align="left" width="22%">Location</Th>
                        <Th width="8%">Games</Th>
                        <Th width="12%">Checked in</Th>
                        <Th width="10%">Played</Th>
                        <Th width="18%">Of those who played</Th>
                        <Th align="left" width="30%">Checked in by</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.map((n) => (
                        <tr key={n.league_id} style={{ borderTop: "1px solid var(--glass-border)" }}>
                          <td className="px-4 py-2.5" style={{ color: "var(--glass-text)" }}>{n.location}</td>
                          <Num>{n.games}</Num>
                          <td className="px-4 py-2.5 text-right tabular">
                            {n.checked_in > 0
                              ? <span style={{ color: "var(--glass-text)" }}>{n.checked_in.toLocaleString()}</span>
                              : <span className={CHIP} style={RED}>None</span>}
                          </td>
                          <Played n={n.played} games={n.games} statsIn={statsIn(n)} />
                          <td className="px-4 py-2.5 text-right tabular whitespace-nowrap">
                            <Share n={n.checked_and_played} of={n.played} />
                          </td>
                          <td className="px-4 py-2.5 text-glass-text-secondary">
                            {n.staff.length ? n.staff.join(", ") : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </section>
              ))
            ) : (
              <Table minWidth={980}>
                <thead>
                  <tr className="text-xs font-bold text-glass-text-tertiary">
                    <Th align="left" width="18%">Location</Th>
                    <Th width="12%">Nights checking in</Th>
                    <Th width="10%">Checked in</Th>
                    <Th width="9%">Played</Th>
                    <Th width="16%">Of those who played</Th>
                    <Th width="11%">Last checked in</Th>
                    <Th align="left" width="24%">Checked in by</Th>
                  </tr>
                </thead>
                <tbody>
                  {locRows.map((r) => (
                    <tr key={r.location} style={{ borderTop: "1px solid var(--glass-border)" }}>
                      <td className="px-4 py-2.5" style={{ color: "var(--glass-text)" }}>{r.location}</td>
                      <td className="px-4 py-2.5 text-right tabular whitespace-nowrap">
                        <span className={CHIP} style={r.checking === 0 ? RED : shareStyle(r.checking, r.nights)}>
                          {r.checking} of {r.nights}
                        </span>
                      </td>
                      <Num>{r.checkedIn.toLocaleString()}</Num>
                      <Played n={r.played} games={r.games} statsIn={r.gamesIn} />
                      <td className="px-4 py-2.5 text-right tabular whitespace-nowrap">
                        <Share n={r.checkedPlayed} of={r.played} />
                      </td>
                      <td className="px-4 py-2.5 text-right tabular whitespace-nowrap text-glass-text-secondary">
                        {r.last ? shortDay(r.last) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-glass-text-secondary">
                        {r.staff.size ? [...r.staff].sort().join(", ") : "—"}
                      </td>
                    </tr>
                  ))}
                  {locRows.length > 1 && (
                    <tr style={{ borderTop: "2px solid var(--glass-border-light)" }}>
                      <td className="px-4 py-3 font-bold" style={{ color: "var(--glass-text)" }}>All locations</td>
                      <td className="px-4 py-3 text-right tabular font-bold whitespace-nowrap" style={{ color: "var(--glass-text)" }}>
                        {nightsChecking} of {nights.length}
                      </td>
                      <Num bold>{checkedIn.toLocaleString()}</Num>
                      <Played n={played} games={games} statsIn={gamesIn} bold />
                      <td className="px-4 py-3 text-right tabular whitespace-nowrap">
                        <Share n={checkedPlayed} of={played} />
                      </td>
                      <td colSpan={2} />
                    </tr>
                  )}
                </tbody>
              </Table>
            )}
          </section>
        </>
      )}

      {events && shownEvents.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold" style={{ color: "var(--glass-text)" }}>Events</h2>
          <Table minWidth={820}>
            <thead>
              <tr className="text-xs font-bold text-glass-text-tertiary">
                <Th align="left" width="16%">Date</Th>
                <Th align="left" width="30%">Event</Th>
                <Th align="left" width="18%">Location</Th>
                <Th width="10%">Going</Th>
                <Th width="11%">Checked in</Th>
                <Th width="15%">Of those going</Th>
              </tr>
            </thead>
            <tbody>
              {shownEvents.map((e: EventRow) => {
                const at = e.starts_at!;
                const [hh, mm] = at.slice(11, 16).split(":").map(Number);
                const time = `${hh % 12 === 0 ? 12 : hh % 12}:${String(mm).padStart(2, "0")} ${hh < 12 ? "am" : "pm"}${TZ_SHORT[e.timezone] ? ` ${TZ_SHORT[e.timezone]}` : ""}`;
                const ci = e.checked_in ?? 0;
                return (
                  <tr key={e.id} style={{ borderTop: "1px solid var(--glass-border)" }}>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <div style={{ color: "var(--glass-text)" }}>{shortDay(at.slice(0, 10))}</div>
                      <div className="text-[11px] text-glass-text-tertiary tabular">{time}</div>
                    </td>
                    <td className="px-4 py-2.5 font-semibold" style={{ color: "var(--glass-text)" }}>{e.name}</td>
                    <td className="px-4 py-2.5" style={{ color: "var(--glass-text)" }}>{e.location}</td>
                    <Num>{e.going.toLocaleString()}</Num>
                    <td className="px-4 py-2.5 text-right tabular">
                      {ci > 0
                        ? <span style={{ color: "var(--glass-text)" }}>{ci.toLocaleString()}</span>
                        : <span className={CHIP} style={RED}>None</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular whitespace-nowrap">
                      <Share n={e.checked_in_going ?? 0} of={e.going} awaiting="No RSVPs" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </section>
      )}

      <p className="text-xs text-glass-text-tertiary max-w-[80ch]">
        From the ops check-ins: staff at the front table check each player in to their game, to the venue, or to an
        event. A game night is one location&apos;s games on one local date, from the first night two or more
        locations checked players in this season. Played is everyone with a stat line or marked as played on that night&apos;s games, so a night
        whose stats aren&apos;t in yet reads awaiting stats, and one with only some games&apos; stats in says how many games under Played
        (a forfeit counts as in). Of those who played is how many of them were checked in:
        green when all were, yellow from 80%, red below. Checked in can run above played: spares, drop-ins and anyone
        checked in without a stat line count there. Events count against everyone with a confirmed RSVP.
      </p>
    </main>
  );
}

// "x of y" with its share as a chip, or a grey note when there is nothing to
// measure against yet.
function Share({ n, of, awaiting = "Awaiting stats" }: { n: number; of: number; awaiting?: string }) {
  if (!of) return <span className={CHIP} style={GREY}>{awaiting}</span>;
  return (
    <span className="inline-flex items-center gap-2 justify-end">
      <span className="text-[11px] text-glass-text-tertiary">{n.toLocaleString()} of {of.toLocaleString()}</span>
      <span className={CHIP} style={shareStyle(n, of)}>{pct(n, of)}</span>
    </span>
  );
}

// Played, with how many of the games have stats in under it while some are
// still to come: the rest of those games' players can't count as played yet.
function Played({ n, games, statsIn, bold = false }: { n: number; games: number; statsIn: number; bold?: boolean }) {
  const partial = n > 0 && statsIn < games;
  return (
    <td className={`px-4 ${bold ? "py-3 font-bold" : "py-2.5"} text-right tabular`}
      style={{ color: n ? "var(--glass-text)" : "var(--glass-text-tertiary)" }}>
      {n ? n.toLocaleString() : "—"}
      {partial && (
        <div className="text-[11px] font-normal text-glass-text-tertiary whitespace-nowrap"
          title={`Stats are in for ${statsIn} of ${games} games`}>
          {statsIn.toLocaleString()} of {games.toLocaleString()} games
        </div>
      )}
    </td>
  );
}

function Table({ children, minWidth }: { children: React.ReactNode; minWidth: number }) {
  return (
    <div className="rounded-2xl bg-glass-surface overflow-hidden shadow-card">
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth, tableLayout: "fixed" }}>
          {children}
        </table>
      </div>
    </div>
  );
}

function Th({ children, align = "right", width }: { children: React.ReactNode; align?: "left" | "right"; width?: string }) {
  return (
    <th className={`px-4 py-2.5 ${align === "left" ? "text-left" : "text-right"} font-bold`} style={width ? { width } : undefined}>
      {children}
    </th>
  );
}

function Num({ children, muted = false, bold = false }: { children: React.ReactNode; muted?: boolean; bold?: boolean }) {
  return (
    <td className={`px-4 ${bold ? "py-3 font-bold" : "py-2.5"} text-right tabular`}
      style={{ color: muted ? "var(--glass-text-tertiary)" : "var(--glass-text)" }}>
      {children}
    </td>
  );
}

function Tile({ label, value, sub, valueStyle }: { label: string; value: string; sub?: string; valueStyle?: React.CSSProperties }) {
  return (
    <div className="rounded-xl bg-glass-surface px-4 py-3.5 min-w-0 flex flex-col shadow-card">
      <div className="text-xs font-bold text-glass-text-tertiary truncate">{label}</div>
      <div className="mt-1.5 text-2xl font-bold tabular leading-tight" style={{ color: "var(--glass-text)", ...valueStyle }}>{value}</div>
      {sub && <div className="text-[11px] text-glass-text-tertiary mt-1 leading-snug">{sub}</div>}
    </div>
  );
}
