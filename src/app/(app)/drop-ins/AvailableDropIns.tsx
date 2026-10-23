import { locParam } from "@/lib/seasons";
import { promoFetch } from "@/lib/promo-feed";
import { TZ_SHORT, dateKey, dayLabel, todayKey } from "./ScheduledDropIns";
import { BasisToggle } from "../dashboard/BasisToggle";
import { STICKY_TH_STYLE, stickyTh, tableScrollBox } from "../dashboard/stickyTable";

// The Available tab: every upcoming game a drop-in program offers spots on,
// with the team that takes the drop-in, its division and how many spots are
// left. By date (the default) reads like the Scheduled tab, a day at a time;
// by location gathers each venue's games together. The Promo Tracker applies each program's own rules (which
// team types, nights, divisions and skill levels, and its caps), the same
// ones the ops admin shows game by game.
const PROMO_APP_URL = process.env.PROMO_APP_URL ?? "https://registration-promo-tracker.vercel.app";

type AvailableRow = {
  location: string;
  // The venue's local wall-clock time ("2026-10-25T20:05"), not converted.
  game_at: string | null;
  game_tz: string;
  team: string;
  opponent: string | null;
  division: string | null;
  dropins: number;
  // Null when the program caps neither drop-ins nor players.
  spots: number | null;
  // The last day the location's program takes sign-ups (absent from an older
  // feed, null when it sets no close date).
  closes_on?: string | null;
};

async function loadAvailable(season: string, locationNames: string[] | null): Promise<AvailableRow[] | null> {
  try {
    const url = new URL("/api/drop-ins", PROMO_APP_URL);
    url.searchParams.set("season", season);
    url.searchParams.set("view", "available");
    const lp = locParam(locationNames);
    if (lp) url.searchParams.set("location", lp);
    const res = await promoFetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as { rows?: AvailableRow[] };
    return Array.isArray(k.rows) ? k.rows : null;
  } catch {
    return null;
  }
}

// Read from the string: it is already the venue's own clock, and Date would
// shift it into the viewer's zone.
function shortDate(at: string | null): string {
  if (!at) return "Date to be set";
  const [y, m, d] = at.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, d)));
}
function timeLabel(at: string | null, tz: string): string {
  if (!at) return "—";
  const [hh, mm] = at.slice(11, 16).split(":").map(Number);
  return `${hh % 12 === 0 ? 12 : hh % 12}:${String(mm).padStart(2, "0")} ${hh < 12 ? "am" : "pm"}${TZ_SHORT[tz] ? ` ${TZ_SHORT[tz]}` : ""}`;
}

const CHIP = "inline-block text-[11px] font-semibold rounded-md px-1.5 py-0.5 whitespace-nowrap";
function SpotsChip({ spots }: { spots: number | null }) {
  if (spots === null) {
    return <span className={CHIP} style={{ color: "var(--glass-text-secondary)", background: "var(--fill-3)" }}>No cap</span>;
  }
  if (spots <= 0) {
    return <span className={CHIP} style={{ color: "var(--red)", background: "var(--red-tint)" }}>Full</span>;
  }
  return <span className={CHIP} style={{ color: "var(--green)", background: "var(--green-tint)" }}>{spots} left</span>;
}

// Column widths shared by every table in a view, so the columns line up from
// one group to the next. The first two columns are the ones the grouping
// doesn't already say: time and location by date, date and time by location.
const COLS = ["11%", "15%", "21%", "14%", "19%", "9%", "11%"];

export default async function AvailableDropIns({
  season,
  locationNames,
  byLocation,
}: {
  season: string;
  locationNames: string[] | null;
  byLocation: boolean;
}) {
  const rows = await loadAvailable(season, locationNames);

  const toggle = (
    <BasisToggle
      param="by"
      value={byLocation ? "location" : "date"}
      options={[{ value: "date", label: "By date" }, { value: "location", label: "By location" }]}
    />
  );

  if (!rows) {
    return (
      <div className="space-y-4">
        {toggle}
        <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary shadow-card">
          Drop-in feed unavailable: the Promo Tracker didn&apos;t answer for {season}.
        </div>
      </div>
    );
  }

  // By date: day, then location, then time, as the Scheduled tab orders its
  // drop-ins, soonest day first. By location: location, then date and time.
  const day = (r: AvailableRow) => dateKey(r.game_at) || "9999";
  const sorted = [...rows].sort((a, b) =>
    (byLocation
      ? a.location.localeCompare(b.location) || day(a).localeCompare(day(b))
      : day(a).localeCompare(day(b)) || a.location.localeCompare(b.location))
    || (a.game_at ?? "").localeCompare(b.game_at ?? "")
    || a.team.localeCompare(b.team));
  const groupOf = (r: AvailableRow) => (byLocation ? r.location : dateKey(r.game_at));
  const groups: { key: string; rows: AvailableRow[] }[] = [];
  for (const r of sorted) {
    const k = groupOf(r);
    const g = groups[groups.length - 1];
    if (g && g.key === k) g.rows.push(r);
    else groups.push({ key: k, rows: [r] });
  }
  // A game where both teams take drop-ins is two rows but one game.
  const gameKey = (r: AvailableRow) => `${r.location}|${r.game_at}|${[r.team, r.opponent ?? ""].sort().join("|")}`;
  const games = new Set(rows.map(gameKey)).size;
  const locations = new Set(rows.map((r) => r.location)).size;
  const full = rows.filter((r) => r.spots !== null && r.spots <= 0).length;
  const today = todayKey();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {toggle}
        <p className="text-sm text-glass-text-secondary">
          {games.toLocaleString()} upcoming {games === 1 ? "game takes" : "games take"} drop-ins at{" "}
          {locations.toLocaleString()} {locations === 1 ? "location" : "locations"}
          {full > 0 && <> · {full.toLocaleString()} {full === 1 ? "team is" : "teams are"} full</>}
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary shadow-card">
          No upcoming games take drop-ins in {season} in this scope.
        </div>
      ) : (
        groups.map((g) => {
          const nGames = new Set(g.rows.map(gameKey)).size;
          return (
            <section key={g.key || "unscheduled"} className="space-y-2">
              <h3 className="text-sm font-semibold" style={{ color: "var(--glass-text)" }}>
                {byLocation ? g.key : <>{g.key === today ? "Today · " : ""}{dayLabel(g.key)}</>}
                <span className="ml-2 text-xs font-normal text-glass-text-tertiary">
                  {nGames} {nGames === 1 ? "game" : "games"}
                  {/* By location, when the venue's program stops taking
                      sign-ups: games after it are listed but can only be
                      booked until then. */}
                  {byLocation && g.rows[0].closes_on && <> · sign-ups close {shortDate(g.rows[0].closes_on)}</>}
                </span>
              </h3>
              <div className="rounded-2xl bg-glass-surface shadow-card">
                <div className={tableScrollBox(820)}>
                  <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: 820, tableLayout: "fixed" }}>
                    <colgroup>
                      {COLS.map((w, i) => <col key={i} style={{ width: w }} />)}
                    </colgroup>
                    <thead>
                      <tr className="text-xs font-bold text-glass-text-tertiary">
                        {byLocation ? (
                          <>
                            <th className={`px-4 py-2.5 text-left font-bold ${stickyTh(820)}`} style={STICKY_TH_STYLE}>Date</th>
                            <th className={`px-4 py-2.5 text-left font-bold ${stickyTh(820)}`} style={STICKY_TH_STYLE}>Time</th>
                          </>
                        ) : (
                          <>
                            <th className={`px-4 py-2.5 text-left font-bold ${stickyTh(820)}`} style={STICKY_TH_STYLE}>Time</th>
                            <th className={`px-4 py-2.5 text-left font-bold ${stickyTh(820)}`} style={STICKY_TH_STYLE}>Location</th>
                          </>
                        )}
                        <th className={`px-4 py-2.5 text-left font-bold ${stickyTh(820)}`} style={STICKY_TH_STYLE}>Team</th>
                        <th className={`px-4 py-2.5 text-left font-bold ${stickyTh(820)}`} style={STICKY_TH_STYLE}>Division</th>
                        <th className={`px-4 py-2.5 text-left font-bold ${stickyTh(820)}`} style={STICKY_TH_STYLE}>Opponent</th>
                        <th className={`px-4 py-2.5 text-right font-bold ${stickyTh(820)}`} style={STICKY_TH_STYLE}>Booked</th>
                        <th className={`px-4 py-2.5 text-left font-bold ${stickyTh(820)}`} style={STICKY_TH_STYLE}>Spots</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.map((r, i) => {
                        const prev = g.rows[i - 1];
                        // A heavier rule where the venue changes (by date) or
                        // the day changes (by location), so each block reads
                        // as one; by location the date shows on its first row.
                        const newBlock = i > 0 && (byLocation ? dateKey(prev.game_at) !== dateKey(r.game_at) : prev.location !== r.location);
                        const firstOfDay = i === 0 || dateKey(prev.game_at) !== dateKey(r.game_at);
                        return (
                          <tr key={`${r.game_at}-${r.location}-${r.team}-${i}`}
                            style={{ borderTop: newBlock ? "2px solid var(--glass-border-light)" : "1px solid var(--glass-border)" }}>
                            {byLocation ? (
                              <>
                                <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: "var(--glass-text)" }}>
                                  {firstOfDay ? shortDate(r.game_at) : ""}
                                </td>
                                <td className="px-4 py-2.5 whitespace-nowrap tabular" style={{ color: "var(--glass-text)" }}>
                                  {timeLabel(r.game_at, r.game_tz)}
                                </td>
                              </>
                            ) : (
                              <>
                                <td className="px-4 py-2.5 whitespace-nowrap tabular" style={{ color: "var(--glass-text)" }}>
                                  {timeLabel(r.game_at, r.game_tz)}
                                </td>
                                <td className="px-4 py-2.5" style={{ color: "var(--glass-text)" }}>{r.location}</td>
                              </>
                            )}
                            <td className="px-4 py-2.5 font-semibold" style={{ color: "var(--glass-text)" }}>{r.team}</td>
                            <td className="px-4 py-2.5 text-glass-text-secondary">{r.division ?? "—"}</td>
                            <td className="px-4 py-2.5 text-glass-text-secondary">{r.opponent ?? "—"}</td>
                            <td className="px-4 py-2.5 text-right tabular"
                              style={{ color: r.dropins ? "var(--glass-text)" : "var(--glass-text-tertiary)" }}>
                              {r.dropins}
                            </td>
                            <td className="px-4 py-2.5"><SpotsChip spots={r.spots} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          );
        })
      )}

      <p className="text-xs text-glass-text-tertiary max-w-[80ch]">
        Every upcoming game a drop-in program offers spots on, by the team that takes the drop-in. Only locations whose
        program is open for sign-ups are listed; a program set up as a draft isn&apos;t offering drop-ins. Each
        program sets which teams take drop-ins (ambassador teams), on which nights and in which divisions, and may cap
        drop-ins or players per team for a game; spots left is the tighter of the two, and no cap means the program
        sets neither. Booked is drop-ins that went through for that team and game. Times are the venue&apos;s own local
        time.
      </p>
    </div>
  );
}
