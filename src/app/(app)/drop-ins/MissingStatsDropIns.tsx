import { locParam } from "@/lib/seasons";
import { promoFetch } from "@/lib/promo-feed";
import { TZ_SHORT, dateKey, dayLabel, todayKey } from "./ScheduledDropIns";
import { STICKY_TH_STYLE, stickyTh, tableScrollBox } from "../dashboard/stickyTable";

// The Missing stats tab: drop-ins for games already played where the player
// has no stat line, and what the game's stats show instead, so their stats
// can be put back on them. The pattern so far: a drop-in sits on their game as
// a game spare that nobody marks as played, and when the sheet is entered
// their line goes on a placeholder like "Spare player" or "6 Player".
const PROMO_APP_URL = process.env.PROMO_APP_URL ?? "https://registration-promo-tracker.vercel.app";

type Finding = "placeholder" | "not_recorded" | "awaiting";
type MissingRow = {
  location: string;
  // The venue's local wall-clock time ("2026-10-25T20:05"), not converted.
  game_at: string | null;
  game_tz: string;
  player: string;
  team: string | null;
  opponent: string | null;
  is_new: boolean;
  marked_played: boolean;
  finding: Finding;
  placeholders: number;
  placeholder_names: string | null;
};

async function loadMissing(season: string, locationNames: string[] | null): Promise<MissingRow[] | null> {
  try {
    const url = new URL("/api/drop-ins", PROMO_APP_URL);
    url.searchParams.set("season", season);
    url.searchParams.set("view", "missing-stats");
    const lp = locParam(locationNames);
    if (lp) url.searchParams.set("location", lp);
    const res = await promoFetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as { rows?: MissingRow[] };
    return Array.isArray(k.rows) ? k.rows : null;
  } catch {
    return null;
  }
}

// Read from the string: it is already the venue's own clock, and Date would
// shift it into the viewer's zone.
function timeLabel(at: string | null, tz: string): string {
  if (!at) return "—";
  const [hh, mm] = at.slice(11, 16).split(":").map(Number);
  return `${hh % 12 === 0 ? 12 : hh % 12}:${String(mm).padStart(2, "0")} ${hh < 12 ? "am" : "pm"}${TZ_SHORT[tz] ? ` ${TZ_SHORT[tz]}` : ""}`;
}

const CHIP = "inline-block text-[11px] font-semibold rounded-md px-1.5 py-0.5 whitespace-nowrap";
const FINDING: Record<Finding, { label: string; style: React.CSSProperties }> = {
  placeholder: { label: "On a placeholder", style: { color: "var(--red)", background: "var(--red-tint)" } },
  not_recorded: { label: "Not on the sheet", style: { color: "var(--amber-ink)", background: "var(--amber-tint)" } },
  awaiting: { label: "Awaiting stats", style: { color: "var(--glass-text-secondary)", background: "var(--fill-3)" } },
};
function findingNote(r: MissingRow): string {
  if (r.finding === "placeholder") {
    const names = r.placeholder_names ?? "a placeholder";
    return r.placeholders > 1
      ? `Team's stats are on ${r.placeholders} placeholders (${names})`
      : `Team's stats include ${names}`;
  }
  if (r.finding === "not_recorded") return "Team's stats are in, none for this player";
  return "No stats for the team yet";
}

// Column widths shared by every day's table: time, location, player, team,
// what the stats show.
const COLS = ["10%", "13%", "21%", "24%", "32%"];

export default async function MissingStatsDropIns({
  season,
  locationNames,
}: {
  season: string;
  locationNames: string[] | null;
}) {
  const rows = await loadMissing(season, locationNames);

  if (!rows) {
    return (
      <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary shadow-card">
        Drop-in feed unavailable: the Promo Tracker didn&apos;t answer for {season}.
      </div>
    );
  }

  // Most recent day first, then location and time, as Scheduled's Past view.
  const sorted = [...rows].sort((a, b) =>
    (dateKey(b.game_at) || "0000").localeCompare(dateKey(a.game_at) || "0000")
    || a.location.localeCompare(b.location)
    || (a.game_at ?? "").localeCompare(b.game_at ?? "")
    || a.player.localeCompare(b.player));
  const groups: { key: string; rows: MissingRow[] }[] = [];
  for (const r of sorted) {
    const k = dateKey(r.game_at);
    const g = groups[groups.length - 1];
    if (g && g.key === k) g.rows.push(r);
    else groups.push({ key: k, rows: [r] });
  }
  const count = (f: Finding) => rows.filter((r) => r.finding === f).length;
  const onPlaceholder = count("placeholder"), notRecorded = count("not_recorded"), awaiting = count("awaiting");
  const today = todayKey();

  return (
    <div className="space-y-4">
      <p className="text-sm text-glass-text-secondary">
        {rows.length.toLocaleString()} {rows.length === 1 ? "drop-in" : "drop-ins"} played with no stats ·{" "}
        {onPlaceholder.toLocaleString()} on a placeholder · {notRecorded.toLocaleString()} not on the sheet ·{" "}
        {awaiting.toLocaleString()} awaiting stats
      </p>

      {onPlaceholder > 0 && (
        <div className="rounded-xl px-4 py-3 text-sm leading-relaxed" style={{ background: "var(--red-tint)", color: "var(--glass-text)" }}>
          <span className="font-semibold" style={{ color: "var(--red)" }}>Stats going to placeholders.</span>{" "}
          A drop-in is added to their game as a game spare, and nobody marks them as played. In {onPlaceholder} of these
          games the team&apos;s stat sheet has a line on a placeholder with no account instead (&ldquo;Spare player&rdquo;,
          &ldquo;6 Player&rdquo;), which is almost certainly the drop-in&apos;s. Their stats need moving from the
          placeholder to the drop-in, and the sheet entered against the drop-in&apos;s own name from now on.
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary shadow-card">
          Every drop-in played in {season} in this scope has stats.
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
            <div className="rounded-2xl bg-glass-surface shadow-card">
              <div className={tableScrollBox(820)}>
                <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: 820, tableLayout: "fixed" }}>
                  <colgroup>
                    {COLS.map((w, i) => <col key={i} style={{ width: w }} />)}
                  </colgroup>
                  <thead>
                    <tr className="text-xs font-bold text-glass-text-tertiary">
                      <th className={`px-4 py-2.5 text-left font-bold ${stickyTh(820)}`} style={STICKY_TH_STYLE}>Time</th>
                      <th className={`px-4 py-2.5 text-left font-bold ${stickyTh(820)}`} style={STICKY_TH_STYLE}>Location</th>
                      <th className={`px-4 py-2.5 text-left font-bold ${stickyTh(820)}`} style={STICKY_TH_STYLE}>Player</th>
                      <th className={`px-4 py-2.5 text-left font-bold ${stickyTh(820)}`} style={STICKY_TH_STYLE}>Team</th>
                      <th className={`px-4 py-2.5 text-left font-bold ${stickyTh(820)}`} style={STICKY_TH_STYLE}>What the stats show</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((r, i) => (
                      <tr key={`${r.game_at}-${r.player}-${i}`}
                        style={{
                          borderTop: i > 0 && g.rows[i - 1].location !== r.location
                            ? "2px solid var(--glass-border-light)"
                            : "1px solid var(--glass-border)",
                        }}>
                        <td className="px-4 py-2.5 whitespace-nowrap tabular align-top" style={{ color: "var(--glass-text)" }}>
                          {timeLabel(r.game_at, r.game_tz)}
                        </td>
                        <td className="px-4 py-2.5 align-top" style={{ color: "var(--glass-text)" }}>{r.location}</td>
                        <td className="px-4 py-2.5 align-top">
                          <span className="font-semibold" style={{ color: "var(--glass-text)" }}>{r.player}</span>
                          <span className={`${CHIP} ml-2`}
                            style={r.is_new
                              ? { color: "var(--amber-ink)", background: "var(--amber-tint)" }
                              : { color: "var(--glass-text-secondary)", background: "var(--fill-3)" }}>
                            {r.is_new ? "New" : "Returning"}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 align-top" style={{ color: "var(--glass-text)" }}>
                          {r.team ?? "—"}
                          {r.opponent && <span className="text-glass-text-tertiary"> vs {r.opponent}</span>}
                        </td>
                        <td className="px-4 py-2.5 align-top">
                          <span className={CHIP} style={FINDING[r.finding].style}>{FINDING[r.finding].label}</span>
                          <div className="mt-1 text-[11px] text-glass-text-tertiary leading-snug">
                            {findingNote(r)}{r.marked_played ? " · marked as played" : " · not marked as played"}
                          </div>
                        </td>
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
        Every drop-in that went through for a game already played where the player has no stat line on the game. On a
        placeholder: the team&apos;s stats include a profile with no account that isn&apos;t on the team&apos;s roster,
        where the drop-in&apos;s line has been going. Not on the sheet: the team&apos;s stats are in with nothing for
        the player, so either they weren&apos;t recorded or they didn&apos;t come. Awaiting stats: nothing is in for
        the team yet. Times are the venue&apos;s own local time.
      </p>
    </div>
  );
}
