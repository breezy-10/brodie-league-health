import { locParam } from "@/lib/seasons";
import { promoFetch } from "@/lib/promo-feed";
import { BasisToggle } from "../dashboard/BasisToggle";

// The Scheduled tab: each drop-in that went through, by the game it is for,
// so a league manager can see who is coming to which game. Upcoming games by
// default, soonest first; Past shows the games already played with whether
// the player showed up.
const PROMO_APP_URL = process.env.PROMO_APP_URL ?? "https://registration-promo-tracker.vercel.app";

type Attendance = "upcoming" | "showed" | "no_show" | "awaiting";
type ScheduledRow = {
  location: string;
  // The venue's local wall-clock time ("2026-10-25T20:05"), not converted.
  game_at: string | null;
  game_tz: string;
  player: string;
  team: string | null;
  opponent: string | null;
  is_new: boolean;
  paid: number;
  attendance: Attendance;
};

async function loadScheduled(season: string, locationNames: string[] | null): Promise<ScheduledRow[] | null> {
  try {
    const url = new URL("/api/drop-ins", PROMO_APP_URL);
    url.searchParams.set("season", season);
    url.searchParams.set("view", "scheduled");
    const lp = locParam(locationNames);
    if (lp) url.searchParams.set("location", lp);
    const res = await promoFetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as { rows?: ScheduledRow[] };
    return Array.isArray(k.rows) ? k.rows : null;
  } catch {
    return null;
  }
}

export const TZ_SHORT: Record<string, string> = {
  "America/New_York": "ET", "America/Toronto": "ET", "America/Detroit": "ET",
  "America/Chicago": "CT", "America/Winnipeg": "CT",
  "America/Denver": "MT", "America/Edmonton": "MT", "America/Phoenix": "MT",
  "America/Los_Angeles": "PT", "America/Vancouver": "PT",
};

// The stored time is already the venue's own clock, so it is read from the
// string rather than through Date, which would shift it into the viewer's zone.
function dateKey(gameAt: string | null): string {
  return gameAt ? gameAt.slice(0, 10) : "";
}
function dayLabel(key: string): string {
  if (!key) return "Date to be set";
  const [y, m, d] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, d)));
}
function timeLabel(gameAt: string | null, tz: string): string {
  if (!gameAt) return "—";
  const [hh, mm] = gameAt.slice(11, 16).split(":").map(Number);
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${hh < 12 ? "am" : "pm"}${TZ_SHORT[tz] ? ` ${TZ_SHORT[tz]}` : ""}`;
}
// Today as the head office reads it, to mark the day's group.
function todayKey(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(new Date());
}

const ATTENDANCE: Record<Exclude<Attendance, "upcoming">, { label: string; style: React.CSSProperties }> = {
  showed: { label: "Showed up", style: { color: "var(--green)", background: "var(--green-tint)" } },
  no_show: { label: "No-show", style: { color: "var(--red)", background: "var(--red-tint)" } },
  awaiting: { label: "Awaiting stats", style: { color: "var(--glass-text-secondary)", background: "var(--fill-3)" } },
};
const CHIP = "inline-block text-[11px] font-semibold rounded-md px-1.5 py-0.5 whitespace-nowrap";
// Column widths shared by every day's table: time, location, player, team,
// price, and on Past, attendance.
const COLS = ["12%", "17%", "27%", "34%", "10%"];
const COLS_PAST = ["11%", "15%", "25%", "29%", "8%", "12%"];

export default async function ScheduledDropIns({
  season,
  locationNames,
  past,
}: {
  season: string;
  locationNames: string[] | null;
  past: boolean;
}) {
  const all = await loadScheduled(season, locationNames);

  const toggle = (
    <BasisToggle
      param="when"
      value={past ? "past" : "upcoming"}
      options={[{ value: "upcoming", label: "Upcoming" }, { value: "past", label: "Past" }]}
    />
  );

  if (!all) {
    return (
      <div className="space-y-4">
        {toggle}
        <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary shadow-card">
          Drop-in feed unavailable: the Promo Tracker didn&apos;t answer for {season}.
        </div>
      </div>
    );
  }

  const rows = all.filter((r) => (past ? r.attendance !== "upcoming" : r.attendance === "upcoming"));
  // Day, then location, then time: each day's drop-ins sit together by venue,
  // in the order the games are played there. Upcoming days soonest first, past
  // days most recent first; within a day it is always earliest game first.
  const sorted = [...rows].sort((a, b) => {
    const da = dateKey(a.game_at) || "9999", db = dateKey(b.game_at) || "9999";
    return (past ? db.localeCompare(da) : da.localeCompare(db))
      || a.location.localeCompare(b.location)
      || (a.game_at ?? "").localeCompare(b.game_at ?? "")
      || a.player.localeCompare(b.player);
  });
  const groups: { key: string; rows: ScheduledRow[] }[] = [];
  for (const r of sorted) {
    const k = dateKey(r.game_at);
    const g = groups[groups.length - 1];
    if (g && g.key === k) g.rows.push(r);
    else groups.push({ key: k, rows: [r] });
  }
  const games = new Set(rows.map((r) => `${r.game_at}|${r.location}|${r.team}|${r.opponent}`)).size;
  const newCount = rows.filter((r) => r.is_new).length;
  const today = todayKey();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {toggle}
        <p className="text-sm text-glass-text-secondary">
          {rows.length.toLocaleString()} {past ? "played" : "upcoming"} {rows.length === 1 ? "drop-in" : "drop-ins"} across{" "}
          {games.toLocaleString()} {games === 1 ? "game" : "games"} · {newCount.toLocaleString()} new,{" "}
          {(rows.length - newCount).toLocaleString()} returning
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary shadow-card">
          {past ? `No drop-in games played yet in ${season} in this scope.` : `No upcoming drop-ins in ${season} in this scope.`}
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.key || "unscheduled"} className="space-y-2">
            <h3 className="text-sm font-semibold" style={{ color: "var(--glass-text)" }}>
              {g.key === today ? "Today · " : ""}{dayLabel(g.key)}
              <span className="ml-2 text-xs font-normal text-glass-text-tertiary">
                {g.rows.length} {g.rows.length === 1 ? "drop-in" : "drop-ins"}
              </span>
            </h3>
            <div className="rounded-2xl bg-glass-surface overflow-hidden shadow-card">
              <div className="overflow-x-auto">
                {/* Fixed layout with the same widths in every day's table, so the
                    columns line up from one day to the next whatever each holds. */}
                <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: 760, tableLayout: "fixed" }}>
                  <colgroup>
                    {(past ? COLS_PAST : COLS).map((w, i) => <col key={i} style={{ width: w }} />)}
                  </colgroup>
                  <thead>
                    <tr className="text-xs font-bold text-glass-text-tertiary">
                      <th className="px-4 py-2.5 text-left font-bold">Time</th>
                      <th className="px-4 py-2.5 text-left font-bold">Location</th>
                      <th className="px-4 py-2.5 text-left font-bold">Player</th>
                      <th className="px-4 py-2.5 text-left font-bold">Team</th>
                      <th className="px-4 py-2.5 text-left font-bold">Price</th>
                      {past && <th className="px-4 py-2.5 text-left font-bold">Attendance</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((r, i) => (
                      <tr key={`${r.game_at}-${r.player}-${i}`}
                        style={{
                          // A heavier rule where the venue changes, so each
                          // location's drop-ins read as one block.
                          borderTop: i > 0 && g.rows[i - 1].location !== r.location
                            ? "2px solid var(--glass-border-light)"
                            : "1px solid var(--glass-border)",
                        }}>
                        <td className="px-4 py-2.5 whitespace-nowrap tabular" style={{ color: "var(--glass-text)" }}>
                          {timeLabel(r.game_at, r.game_tz)}
                        </td>
                        <td className="px-4 py-2.5" style={{ color: "var(--glass-text)" }}>{r.location}</td>
                        <td className="px-4 py-2.5">
                          <span className="font-semibold" style={{ color: "var(--glass-text)" }}>{r.player}</span>
                          <span className={`${CHIP} ml-2`}
                            style={r.is_new
                              ? { color: "var(--amber-ink)", background: "var(--amber-tint)" }
                              : { color: "var(--glass-text-secondary)", background: "var(--fill-3)" }}>
                            {r.is_new ? "New" : "Returning"}
                          </span>
                        </td>
                        <td className="px-4 py-2.5" style={{ color: "var(--glass-text)" }}>
                          {r.team ?? "—"}
                          {r.opponent && <span className="text-glass-text-tertiary"> vs {r.opponent}</span>}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-glass-text-secondary">
                          {r.paid > 0 ? "Paid" : "Free"}
                        </td>
                        {past && r.attendance !== "upcoming" && (
                          <td className="px-4 py-2.5">
                            <span className={CHIP} style={ATTENDANCE[r.attendance].style}>{ATTENDANCE[r.attendance].label}</span>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        ))
      )}

      <p className="text-xs text-glass-text-tertiary max-w-[80ch]">
        Every drop-in that went through, by the game it is for. Times are the venue&apos;s own local time. Past games
        show whether the player showed up: a stat line or marked as played on the game; a no-show is a game whose stats
        are in for their team but not for them; awaiting stats is a game with none in for their team yet.
      </p>
    </div>
  );
}
