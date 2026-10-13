import { locParam } from "@/lib/seasons";
import { promoFetch } from "@/lib/promo-feed";
import { TZ_SHORT } from "./ScheduledDropIns";

// The Available tab: every upcoming game a drop-in program offers spots on, by
// location, with the team that takes the drop-in, its division and how many
// spots are left. The Promo Tracker applies each program's own rules (which
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
function dateLabel(at: string | null): string {
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

// Column widths shared by every location's table, so the columns line up from
// one location to the next: date, time, team, division, opponent, booked,
// spots left.
const COLS = ["12%", "11%", "22%", "15%", "20%", "9%", "11%"];

export default async function AvailableDropIns({
  season,
  locationNames,
}: {
  season: string;
  locationNames: string[] | null;
}) {
  const rows = await loadAvailable(season, locationNames);

  if (!rows) {
    return (
      <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary shadow-card">
        Drop-in feed unavailable: the Promo Tracker didn&apos;t answer for {season}.
      </div>
    );
  }

  // Location, then date and time, then team.
  const sorted = [...rows].sort((a, b) =>
    a.location.localeCompare(b.location)
    || (a.game_at ?? "9999").localeCompare(b.game_at ?? "9999")
    || a.team.localeCompare(b.team));
  const groups: { location: string; rows: AvailableRow[] }[] = [];
  for (const r of sorted) {
    const g = groups[groups.length - 1];
    if (g && g.location === r.location) g.rows.push(r);
    else groups.push({ location: r.location, rows: [r] });
  }
  // A game where both teams take drop-ins is two rows but one game.
  const gameKey = (r: AvailableRow) => `${r.location}|${r.game_at}|${[r.team, r.opponent ?? ""].sort().join("|")}`;
  const games = new Set(rows.map(gameKey)).size;
  const full = rows.filter((r) => r.spots !== null && r.spots <= 0).length;

  return (
    <div className="space-y-4">
      <p className="text-sm text-glass-text-secondary">
        {games.toLocaleString()} upcoming {games === 1 ? "game takes" : "games take"} drop-ins at{" "}
        {groups.length.toLocaleString()} {groups.length === 1 ? "location" : "locations"}
        {full > 0 && <> · {full.toLocaleString()} {full === 1 ? "team is" : "teams are"} full</>}
      </p>

      {rows.length === 0 ? (
        <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary shadow-card">
          No upcoming games take drop-ins in {season} in this scope.
        </div>
      ) : (
        groups.map((g) => {
          const nGames = new Set(g.rows.map(gameKey)).size;
          return (
            <section key={g.location} className="space-y-2">
              <h3 className="text-sm font-semibold" style={{ color: "var(--glass-text)" }}>
                {g.location}
                <span className="ml-2 text-xs font-normal text-glass-text-tertiary">
                  {nGames} {nGames === 1 ? "game" : "games"}
                </span>
              </h3>
              <div className="rounded-2xl bg-glass-surface overflow-hidden shadow-card">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: 820, tableLayout: "fixed" }}>
                    <colgroup>
                      {COLS.map((w, i) => <col key={i} style={{ width: w }} />)}
                    </colgroup>
                    <thead>
                      <tr className="text-xs font-bold text-glass-text-tertiary">
                        <th className="px-4 py-2.5 text-left font-bold">Date</th>
                        <th className="px-4 py-2.5 text-left font-bold">Time</th>
                        <th className="px-4 py-2.5 text-left font-bold">Team</th>
                        <th className="px-4 py-2.5 text-left font-bold">Division</th>
                        <th className="px-4 py-2.5 text-left font-bold">Opponent</th>
                        <th className="px-4 py-2.5 text-right font-bold">Booked</th>
                        <th className="px-4 py-2.5 text-left font-bold">Spots</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.map((r, i) => {
                        const day = (r.game_at ?? "").slice(0, 10);
                        const newDay = i === 0 || (g.rows[i - 1].game_at ?? "").slice(0, 10) !== day;
                        return (
                          <tr key={`${r.game_at}-${r.team}-${i}`}
                            style={{
                              // A heavier rule where the date changes, so each
                              // night's games read as one block.
                              borderTop: i > 0 && newDay
                                ? "2px solid var(--glass-border-light)"
                                : "1px solid var(--glass-border)",
                            }}>
                            <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: "var(--glass-text)" }}>
                              {newDay ? dateLabel(r.game_at) : ""}
                            </td>
                            <td className="px-4 py-2.5 whitespace-nowrap tabular" style={{ color: "var(--glass-text)" }}>
                              {timeLabel(r.game_at, r.game_tz)}
                            </td>
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
        Every upcoming game a drop-in program offers spots on, by the team that takes the drop-in. Each location&apos;s
        program sets which teams take drop-ins (ambassador teams), on which nights and in which divisions, and may cap
        drop-ins or players per team for a game; spots left is the tighter of the two, and no cap means the program
        sets neither. Booked is drop-ins that went through for that team and game. Times are the venue&apos;s own local
        time.
      </p>
    </div>
  );
}
