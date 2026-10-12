import { canonicalLocation, csvParam, locParam } from "@/lib/seasons";
import { getCanonicalLocations } from "@/lib/districts-locations";
import { getActiveLocationKeys, onlyActive } from "@/lib/active-locations";
import Filters, { type FilterOptions } from "../dashboard/Filters";
import { BasisToggle } from "../dashboard/BasisToggle";
import { requireUser } from "@/lib/auth";
import { promoFetch } from "@/lib/promo-feed";

// Events: open runs, Kicks of the Week, opening nights, beginner runs, all-star
// games and the rest, from the ops events platform via the Promo Tracker. For
// each, who's going, how many were new to Brodie, and how many of those went
// on to register for a season. Events aren't tied to one season (an open run
// sells the next season, an opening night starts the current one), so the page
// splits them into upcoming and past instead of filtering by season.
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

const TZ_SHORT: Record<string, string> = {
  "America/New_York": "ET", "America/Toronto": "ET", "America/Detroit": "ET",
  "America/Chicago": "CT", "America/Winnipeg": "CT",
  "America/Denver": "MT", "America/Edmonton": "MT", "America/Phoenix": "MT",
  "America/Los_Angeles": "PT", "America/Vancouver": "PT",
};
// Read from the string: it is already the event's own clock, and Date would
// shift it into the viewer's zone.
function whenLabel(at: string | null, tz: string): { day: string; time: string } {
  if (!at) return { day: "Date to be set", time: "" };
  const [y, m, d] = at.slice(0, 10).split("-").map(Number);
  const day = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, d)));
  const [hh, mm] = at.slice(11, 16).split(":").map(Number);
  const time = `${hh % 12 === 0 ? 12 : hh % 12}:${String(mm).padStart(2, "0")} ${hh < 12 ? "am" : "pm"}${TZ_SHORT[tz] ? ` ${TZ_SHORT[tz]}` : ""}`;
  return { day, time };
}

const pct = (n: number, of: number) => (of ? `${Math.round((100 * n) / of)}%` : "—");
const CHIP = "inline-block text-[11px] font-semibold rounded-md px-1.5 py-0.5 whitespace-nowrap";

export default async function EventsView({
  searchParams,
}: {
  searchParams: Promise<{ location?: string; when?: string }>;
}) {
  await requireUser();
  const { location: locationParam, when: whenParam } = await searchParams;
  const past = whenParam === "past";
  const selectedLocations = csvParam(locationParam).map(canonicalLocation);
  const locationNames = selectedLocations.length ? selectedLocations : null;

  // Locations with a captain this season or next, as every location filter
  // lists; events at a venue no league plays at still show under All.
  const [canonical, active, all] = await Promise.all([
    getCanonicalLocations(),
    getActiveLocationKeys([]),
    loadEvents(locationNames),
  ]);
  const options: FilterOptions = { seasons: [], locations: onlyActive(canonical, active, selectedLocations) };

  const events = (all ?? [])
    .filter((e) => e.upcoming !== past)
    .sort((a, b) => {
      const x = a.starts_at ?? "", y = b.starts_at ?? "";
      return past ? y.localeCompare(x) : x.localeCompare(y);
    });
  const sum = (k: keyof EventRow) => events.reduce((s, e) => s + ((e[k] as number) ?? 0), 0);
  const going = sum("going"), rsvps = sum("rsvps"), newPlayers = sum("new_players"), converted = sum("converted");
  const anyPaid = events.some((e) => e.paid > 0);

  return (
    <main className="brodie-fade-in space-y-6">
      <Filters
        key={selectedLocations.join(",")}
        options={options}
        current={{ seasons: [], locations: selectedLocations }}
        keep={past ? { when: "past" } : undefined}
      />

      <BasisToggle
        param="when"
        value={past ? "past" : "upcoming"}
        options={[{ value: "upcoming", label: "Upcoming" }, { value: "past", label: "Past" }]}
      />

      {!all ? (
        <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary shadow-card">
          Events feed unavailable: the Promo Tracker didn&apos;t answer.
        </div>
      ) : (
        <>
          <div className={`grid gap-3 grid-cols-2 ${past ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
            <Tile label={past ? "Events held" : "Upcoming events"} value={events.length.toLocaleString()} />
            <Tile label="Going" value={going.toLocaleString()}
              sub={`${rsvps.toLocaleString()} RSVPs · ${sum("cancelled").toLocaleString()} cancelled`} />
            <Tile label="New to Brodie" value={newPlayers.toLocaleString()}
              sub={`${pct(newPlayers, going)} of those going had never played`} />
            {past && (
              <Tile label="Became registrations" value={pct(converted, newPlayers)}
                sub={`${converted.toLocaleString()} of ${newPlayers.toLocaleString()} new players registered for a season after`} />
            )}
          </div>

          {events.length === 0 ? (
            <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary shadow-card">
              {past ? "No past events in this scope." : "No upcoming events in this scope."}
            </div>
          ) : (
            <div className="rounded-2xl bg-glass-surface overflow-hidden shadow-card">
              <div className="overflow-x-auto">
                <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: 860 }}>
                  <thead>
                    <tr className="text-xs font-bold text-glass-text-tertiary">
                      <Th align="left">Date</Th>
                      <Th align="left">Event</Th>
                      <Th align="left">Location</Th>
                      <Th>Going</Th>
                      <Th>New to Brodie</Th>
                      {past && <Th>Became registrations</Th>}
                      {anyPaid && <Th>Paid</Th>}
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((e) => {
                      const w = whenLabel(e.starts_at, e.timezone);
                      return (
                        <tr key={e.id} style={{ borderTop: "1px solid var(--glass-border)" }}>
                          <td className="px-4 py-2.5 whitespace-nowrap align-top">
                            <div style={{ color: "var(--glass-text)" }}>{w.day}</div>
                            <div className="text-[11px] text-glass-text-tertiary tabular">{w.time}</div>
                          </td>
                          <td className="px-4 py-2.5 align-top">
                            <div className="font-semibold" style={{ color: "var(--glass-text)" }}>{e.name}</div>
                            <div className="mt-1 flex flex-wrap gap-1.5">
                              <span className={CHIP} style={{ color: "var(--glass-text-secondary)", background: "var(--fill-3)" }}>{e.kind}</span>
                              {e.is_private && (
                                <span className={CHIP} style={{ color: "var(--glass-text-secondary)", background: "var(--fill-3)" }}>Private</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 align-top">
                            <div style={{ color: "var(--glass-text)" }}>{e.location}</div>
                            {e.venue && e.venue !== e.location && (
                              <div className="text-[11px] text-glass-text-tertiary">{e.venue}</div>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular align-top whitespace-nowrap">
                            <div className="font-semibold" style={{ color: "var(--glass-text)" }}>{e.going.toLocaleString()}</div>
                            <div className="text-[11px] text-glass-text-tertiary">of {e.rsvps.toLocaleString()} RSVPs</div>
                          </td>
                          <td className="px-4 py-2.5 text-right tabular align-top" style={{ color: "var(--glass-text)" }}>
                            {e.new_players.toLocaleString()}
                          </td>
                          {past && (
                            <td className="px-4 py-2.5 text-right tabular align-top whitespace-nowrap">
                              <div style={{ color: "var(--glass-text)" }}>{pct(e.converted, e.new_players)}</div>
                              <div className="text-[11px] text-glass-text-tertiary">{e.converted} of {e.new_players}</div>
                            </td>
                          )}
                          {anyPaid && (
                            <td className="px-4 py-2.5 text-right tabular align-top" style={{ color: "var(--glass-text)" }}>
                              {e.paid ? e.paid.toLocaleString() : "—"}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      <p className="text-xs text-glass-text-tertiary max-w-[80ch]">
        Events from the ops events platform. Going is everyone with a confirmed RSVP, each person once. New to Brodie
        means no roster spot and no completed season registration before they RSVP&apos;d; became registrations is
        those new players who completed a paid season registration after the event. Times are the event&apos;s own
        local time. The type is read from the event&apos;s name.
      </p>
    </main>
  );
}

function Th({ children, align = "right" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <th className={`px-4 py-2.5 ${align === "left" ? "text-left" : "text-right"} font-bold`}>{children}</th>;
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-glass-surface px-4 py-3.5 min-w-0 flex flex-col shadow-card">
      <div className="text-xs font-bold text-glass-text-tertiary truncate">{label}</div>
      <div className="mt-1.5 text-2xl font-bold tabular leading-tight" style={{ color: "var(--glass-text)" }}>{value}</div>
      {sub && <div className="text-[11px] text-glass-text-tertiary mt-1 leading-snug">{sub}</div>}
    </div>
  );
}
