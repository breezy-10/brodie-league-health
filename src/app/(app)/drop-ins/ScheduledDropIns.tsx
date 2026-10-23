import { locParam } from "@/lib/seasons";
import { promoFetch } from "@/lib/promo-feed";
import { TZ_SHORT } from "@/lib/tz";
import { STICKY_TH, STICKY_TH_STYLE, tableScrollBox } from "../dashboard/stickyTable";

export { TZ_SHORT };

// The Scheduled and Past tabs: each drop-in that went through, by the game it
// is for. Scheduled is the games still to come, soonest first, so a league
// manager can see who is coming to which game; Past is the games already
// played, most recent first, with whether the player showed up. Either can
// instead be read by the day each drop-in was registered, newest first.
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
  // The ops game id (absent from an older feed).
  game_id?: string | null;
  // When the drop-in went through, as a UTC ISO instant (absent from an
  // older feed).
  registered_at?: string | null;
  // Where the player's stats went on a game already played (absent from an
  // older feed; null for a game to come), and the placeholders' names when
  // they went to one.
  stat_line?: StatLine | null;
  placeholder_names?: string | null;
};
type StatLine = "player" | "placeholder" | "not_recorded" | "awaiting";

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


// The stored time is already the venue's own clock, so it is read from the
// string rather than through Date, which would shift it into the viewer's zone.
export function dateKey(gameAt: string | null): string {
  return gameAt ? gameAt.slice(0, 10) : "";
}
export function dayLabel(key: string): string {
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
// An instant as the venue's own wall-clock time, in the same form as game_at
// ("2026-10-20T18:31"), so a registration reads in the zone its game does.
function venueLocal(iso: string | null | undefined, tz: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
    return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
  } catch {
    return null;
  }
}
// The game's day and time on one line, for the registration view, where the
// day heading is the registration's rather than the game's.
function gameLabel(gameAt: string | null, tz: string): string {
  if (!gameAt) return "Date to be set";
  const [y, m, d] = gameAt.slice(0, 10).split("-").map(Number);
  const day = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, d)));
  return `${day} · ${timeLabel(gameAt, tz)}`;
}
// Today as the head office reads it, to mark the day's group.
export function todayKey(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(new Date());
}

const ATTENDANCE: Record<Exclude<Attendance, "upcoming">, { label: string; style: React.CSSProperties }> = {
  showed: { label: "Showed up", style: { color: "var(--green)", background: "var(--green-tint)" } },
  no_show: { label: "No-show", style: { color: "var(--red)", background: "var(--red-tint)" } },
  awaiting: { label: "Awaiting stats", style: { color: "var(--glass-text-secondary)", background: "var(--fill-3)" } },
};
const CHIP = "inline-block text-[11px] font-semibold rounded-md px-1.5 py-0.5 whitespace-nowrap";
// Where the stats went: on the player, on a spare (a placeholder profile with
// no account and no roster spot, like "Spare player" or "6 Player"), not on
// the team's sheet at all, or no sheet yet. The Missing stats tab lists every
// drop-in without a line of their own.
const STAT_LINE: Record<StatLine, { label: string; style: React.CSSProperties }> = {
  player: { label: "On player", style: { color: "var(--green)", background: "var(--green-tint)" } },
  placeholder: { label: "On a spare", style: { color: "var(--red)", background: "var(--red-tint)" } },
  not_recorded: { label: "Not on sheet", style: { color: "var(--amber-ink)", background: "var(--amber-tint)" } },
  awaiting: { label: "No stats yet", style: { color: "var(--glass-text-secondary)", background: "var(--fill-3)" } },
};
// Column widths shared by every day's table: time, location, player, team,
// price, and on Past, attendance, where the stats went, and the game's
// BallerTV, admin and stats links.
const COLS = ["12%", "17%", "27%", "34%", "10%"];
const COLS_PAST = ["8%", "10%", "16%", "19%", "5%", "10%", "11%", "7%", "7%", "7%"];
// By registration date: the registration time, then the game's day and time.
const COLS_REG = ["10%", "17%", "14%", "23%", "28%", "8%"];
const COLS_PAST_REG = ["7%", "11%", "9%", "14%", "16%", "5%", "9%", "10%", "6%", "6%", "7%"];

// The game on BallerTV, found when clicked (see /go/ballertv), and on the
// admin and stats sites by its ops id: the same three links Stats Health
// gives each game.
const ballerTvHref = (r: ScheduledRow) => `/go/ballertv?${new URLSearchParams({
  location: r.location, at: r.game_at ?? "", tz: r.game_tz, home: r.team ?? "", away: r.opponent ?? "",
})}`;
const LINK_STYLE: React.CSSProperties = { height: 24, padding: "0 8px", fontSize: 11 };
function GameLink({ href, label, title }: { href: string | null; label: string; title: string }) {
  if (!href) return <span className="text-glass-text-tertiary">—</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="br-btn is-outline is-sm whitespace-nowrap"
      style={LINK_STYLE} title={title}>
      {label} ↗
    </a>
  );
}

export default async function ScheduledDropIns({
  season,
  locationNames,
  past,
  byRegistered = false,
}: {
  season: string;
  locationNames: string[] | null;
  past: boolean;
  byRegistered?: boolean;
}) {
  const all = await loadScheduled(season, locationNames);

  if (!all) {
    return (
      <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary shadow-card">
        Drop-in feed unavailable: the Promo Tracker didn&apos;t answer for {season}.
      </div>
    );
  }

  const rows = all.filter((r) => (past ? r.attendance !== "upcoming" : r.attendance === "upcoming"));
  // Day, then location, then time: each day's drop-ins sit together by venue,
  // in the order the games are played there. Upcoming days soonest first, past
  // days most recent first; within a day it is always earliest game first.
  // By registration date it is the day each drop-in went through, in its
  // venue's own time, newest day first and newest first within it, so the
  // latest sign-ups lead.
  const regAt = new Map(rows.map((r) => [r, venueLocal(r.registered_at, r.game_tz)]));
  const groupKey = (r: ScheduledRow) => dateKey(byRegistered ? regAt.get(r) ?? null : r.game_at);
  const sorted = [...rows].sort((a, b) => {
    if (byRegistered) {
      return (groupKey(b) || "0000").localeCompare(groupKey(a) || "0000")
        || (b.registered_at ?? "").localeCompare(a.registered_at ?? "")
        || a.player.localeCompare(b.player);
    }
    const da = dateKey(a.game_at) || "9999", db = dateKey(b.game_at) || "9999";
    return (past ? db.localeCompare(da) : da.localeCompare(db))
      || a.location.localeCompare(b.location)
      || (a.game_at ?? "").localeCompare(b.game_at ?? "")
      || a.player.localeCompare(b.player);
  });
  const groups: { key: string; rows: ScheduledRow[] }[] = [];
  for (const r of sorted) {
    const k = groupKey(r);
    const g = groups[groups.length - 1];
    if (g && g.key === k) g.rows.push(r);
    else groups.push({ key: k, rows: [r] });
  }
  const games = new Set(rows.map((r) => `${r.game_at}|${r.location}|${r.team}|${r.opponent}`)).size;
  const newCount = rows.filter((r) => r.is_new).length;
  const today = todayKey();
  const tableMin = (past ? 1240 : 760) + (byRegistered ? 140 : 0);

  return (
    <div className="space-y-4">
      <p className="text-sm text-glass-text-secondary">
        {rows.length.toLocaleString()} {past ? "played" : "upcoming"} {rows.length === 1 ? "drop-in" : "drop-ins"} across{" "}
        {games.toLocaleString()} {games === 1 ? "game" : "games"} · {newCount.toLocaleString()} new,{" "}
        {(rows.length - newCount).toLocaleString()} returning
      </p>

      {rows.length === 0 ? (
        <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary shadow-card">
          {past ? `No drop-in games played yet in ${season} in this scope.` : `No upcoming drop-ins in ${season} in this scope.`}
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.key || "unscheduled"} className="space-y-2">
            <h3 className="text-sm font-semibold" style={{ color: "var(--glass-text)" }}>
              {g.key === today ? "Today · " : ""}
              {!g.key && byRegistered ? "Registration date unknown" : dayLabel(g.key)}
              <span className="ml-2 text-xs font-normal text-glass-text-tertiary">
                {g.rows.length} {g.rows.length === 1 ? "drop-in" : "drop-ins"}
              </span>
            </h3>
            <div className="rounded-2xl bg-glass-surface shadow-card">
              <div className={tableScrollBox(tableMin)}>
                {/* Fixed layout with the same widths in every day's table, so the
                    columns line up from one day to the next whatever each holds. */}
                <table className="w-full text-sm"
                  style={{ borderCollapse: "collapse", minWidth: tableMin, tableLayout: "fixed" }}>
                  <colgroup>
                    {(byRegistered ? (past ? COLS_PAST_REG : COLS_REG) : (past ? COLS_PAST : COLS))
                      .map((w, i) => <col key={i} style={{ width: w }} />)}
                  </colgroup>
                  <thead>
                    <tr className="text-xs font-bold text-glass-text-tertiary">
                      {byRegistered ? (
                        <>
                          <th className={`px-4 py-2.5 text-left font-bold ${STICKY_TH}`} style={STICKY_TH_STYLE}>Registered</th>
                          <th className={`px-4 py-2.5 text-left font-bold ${STICKY_TH}`} style={STICKY_TH_STYLE}>Game</th>
                        </>
                      ) : (
                        <th className={`px-4 py-2.5 text-left font-bold ${STICKY_TH}`} style={STICKY_TH_STYLE}>Time</th>
                      )}
                      <th className={`px-4 py-2.5 text-left font-bold ${STICKY_TH}`} style={STICKY_TH_STYLE}>Location</th>
                      <th className={`px-4 py-2.5 text-left font-bold ${STICKY_TH}`} style={STICKY_TH_STYLE}>Player</th>
                      <th className={`px-4 py-2.5 text-left font-bold ${STICKY_TH}`} style={STICKY_TH_STYLE}>Team</th>
                      <th className={`px-4 py-2.5 text-left font-bold ${STICKY_TH}`} style={STICKY_TH_STYLE}>Price</th>
                      {past && (
                        <>
                          <th className={`px-4 py-2.5 text-left font-bold ${STICKY_TH}`} style={STICKY_TH_STYLE}>Attendance</th>
                          <th className={`px-2 py-2.5 text-left font-bold ${STICKY_TH}`} style={STICKY_TH_STYLE}>Stat line</th>
                          <th className={`px-2 py-2.5 text-left font-bold ${STICKY_TH}`} style={STICKY_TH_STYLE}>BallerTV</th>
                          <th className={`px-2 py-2.5 text-left font-bold ${STICKY_TH}`} style={STICKY_TH_STYLE}>Admin</th>
                          <th className={`px-2 py-2.5 text-left font-bold ${STICKY_TH}`} style={STICKY_TH_STYLE}>Stats</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((r, i) => (
                      <tr key={`${r.game_at}-${r.player}-${i}`}
                        style={{
                          // A heavier rule where the venue changes, so each
                          // location's drop-ins read as one block. By
                          // registration the rows run by time, not venue.
                          borderTop: !byRegistered && i > 0 && g.rows[i - 1].location !== r.location
                            ? "2px solid var(--glass-border-light)"
                            : "1px solid var(--glass-border)",
                        }}>
                        {byRegistered ? (
                          <>
                            <td className="px-4 py-2.5 whitespace-nowrap tabular" style={{ color: "var(--glass-text)" }}>
                              {timeLabel(regAt.get(r) ?? null, r.game_tz)}
                            </td>
                            <td className="px-4 py-2.5 whitespace-nowrap tabular" style={{ color: "var(--glass-text)" }}>
                              {gameLabel(r.game_at, r.game_tz)}
                            </td>
                          </>
                        ) : (
                          <td className="px-4 py-2.5 whitespace-nowrap tabular" style={{ color: "var(--glass-text)" }}>
                            {timeLabel(r.game_at, r.game_tz)}
                          </td>
                        )}
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
                          <>
                            <td className="px-4 py-2.5">
                              <span className={CHIP} style={ATTENDANCE[r.attendance].style}>{ATTENDANCE[r.attendance].label}</span>
                            </td>
                            <td className="px-2 py-2.5">
                              {r.stat_line ? (
                                <>
                                  <span className={CHIP} style={STAT_LINE[r.stat_line].style}>{STAT_LINE[r.stat_line].label}</span>
                                  {r.stat_line === "placeholder" && r.placeholder_names && (
                                    <div className="mt-0.5 text-[11px] text-glass-text-tertiary truncate" title={r.placeholder_names}>
                                      {r.placeholder_names}
                                    </div>
                                  )}
                                </>
                              ) : (
                                <span className="text-glass-text-tertiary">—</span>
                              )}
                            </td>
                            <td className="px-2 py-2.5">
                              <GameLink href={r.game_at ? ballerTvHref(r) : null} label="BallerTV"
                                title="Watch on BallerTV (opens the game's stream, or its event if the game isn't listed)" />
                            </td>
                            <td className="px-2 py-2.5">
                              <GameLink href={r.game_id ? `https://admin.brodierec.com/games/${r.game_id}` : null} label="Admin"
                                title="Open this game on the admin site" />
                            </td>
                            <td className="px-2 py-2.5">
                              <GameLink href={r.game_id ? `https://stats.brodierec.com/games/${r.game_id}` : null} label="Stats"
                                title="Open this game on stats.brodierec.com" />
                            </td>
                          </>
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
        {past ? (
          <>
            Every drop-in that went through for a game already played, {byRegistered
              ? "by the day it was registered, newest first"
              : "by the game it was for"}. Showed up is a stat line
            or marked as played on the game; a no-show is a game whose stats are in for their team but not for them;
            awaiting stats is a game with none in for their team yet. Stat line says where their stats went: on the
            player, on a spare (a placeholder with no account and no roster spot, like &ldquo;Spare player&rdquo;),
            not on their team&apos;s sheet, or no stats in yet. Times are the venue&apos;s own local time.
            {byRegistered && " Registered is when the drop-in went through (paid, or confirmed when free)."}
          </>
        ) : (
          <>
            Every drop-in that went through for a game still to come, {byRegistered
              ? "by the day it was registered, newest first"
              : "by the game it is for"}. Times are the venue&apos;s own local time.
            {byRegistered && " Registered is when the drop-in went through (paid, or confirmed when free)."}
          </>
        )}
      </p>
    </div>
  );
}
