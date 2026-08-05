import Link from "next/link";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PROMO_URL = "https://registration-promo-tracker.vercel.app";

type Cell = { teams: number; athletes: number };
type DayRow = { day: string; current: Cell; prev_season: Cell; prev_year: Cell };
type RosterSize = { roster_size: number; team_count: number };
type Breakdown = {
  location: string;
  day_n: number | null;
  seasons: { current: string; prev_season: string; prev_year: string };
  days: DayRow[];
  roster_sizes: RosterSize[];
};

// "Summer '26" -> "SU'26".
const TERM_ABBR: Record<string, string> = { winter: "W", spring: "SP", summer: "SU", fall: "F" };
function shortSeason(name: string): string {
  const t = name.toLowerCase().match(/winter|spring|summer|fall/)?.[0];
  const yy = (name.match(/\d{2,4}/)?.[0] ?? "").slice(-2);
  return t ? `${TERM_ABBR[t]}'${yy}` : name;
}
const deltaColor = (d: number) =>
  d === 0 ? "var(--glass-text-secondary)" : d > 0 ? "rgb(74,222,128)" : "rgb(248,113,113)";
const signed = (d: number) => `${d > 0 ? "+" : ""}${d.toLocaleString()}`;
// >= 8.5 green, >= 7.5 yellow, below red (matches the location cards).
function avgColor(avg: number | null): string {
  if (avg === null) return "var(--glass-text-secondary)";
  return avg >= 8.5 ? "rgb(74,222,128)" : avg >= 7.5 ? "var(--glass-gold)" : "rgb(248,113,113)";
}

async function loadBreakdown(loc: string, season: string): Promise<Breakdown | null> {
  try {
    const url = `${PROMO_URL}/api/registration-day-breakdown?location=${encodeURIComponent(loc)}&season=${encodeURIComponent(season)}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as Breakdown | { error: string };
    if ("error" in json) return null;
    return json;
  } catch {
    return null;
  }
}

function Metric({ cur, prev, year, prevLabel, yearLabel }: {
  cur: number; prev: number; year: number; prevLabel: string; yearLabel: string;
}) {
  const dp = cur - prev, dy = cur - year;
  return (
    <div>
      <div className="text-xl font-bold tabular leading-tight" style={{ color: "var(--glass-text)" }}>{cur.toLocaleString()}</div>
      <div className="text-[11px] font-semibold mt-0.5" style={{ color: deltaColor(dp) }}>
        {signed(dp)} <span className="font-normal text-glass-text-tertiary">vs {prevLabel}</span>
      </div>
      <div className="text-[11px] font-semibold" style={{ color: deltaColor(dy) }}>
        {signed(dy)} <span className="font-normal text-glass-text-tertiary">vs {yearLabel}</span>
      </div>
    </div>
  );
}

// Vertical bar chart: how many teams have N registered players. Contiguous
// roster sizes from min..max, gaps rendered as zero-height bars.
function RosterChart({ sizes, season }: { sizes: RosterSize[]; season: string }) {
  if (!sizes.length) return null;
  const min = Math.min(...sizes.map((s) => s.roster_size));
  const max = Math.max(...sizes.map((s) => s.roster_size));
  const countBy = new Map(sizes.map((s) => [s.roster_size, s.team_count]));
  const bars: { size: number; count: number }[] = [];
  for (let n = min; n <= max; n++) bars.push({ size: n, count: countBy.get(n) ?? 0 });
  const maxCount = Math.max(1, ...bars.map((b) => b.count));
  const totalTeams = bars.reduce((a, b) => a + b.count, 0);
  const TRACK = 160;
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold" style={{ color: "var(--glass-text)" }}>Players registered per team</h2>
        <p className="text-sm text-glass-text-secondary">How many teams have each roster size · {season} · {totalTeams.toLocaleString()} teams</p>
      </div>
      <div className="rounded-2xl border border-glass-border bg-glass-surface p-5 overflow-x-auto">
        <div className="flex items-end gap-2" style={{ height: TRACK + 28, minWidth: bars.length * 40 }}>
          {bars.map((b) => (
            <div key={b.size} className="flex flex-col items-center justify-end gap-1 flex-1" style={{ minWidth: 30 }}>
              <span className="text-[11px] font-semibold tabular" style={{ color: "var(--glass-text-secondary)" }}>{b.count}</span>
              <div
                className="w-full rounded-t"
                style={{
                  height: Math.max(2, Math.round((b.count / maxCount) * TRACK)),
                  background: b.count > 0 ? "var(--glass-gold)" : "var(--glass-border-light)",
                  minWidth: 18,
                }}
                title={`${b.count} team${b.count === 1 ? "" : "s"} with ${b.size} player${b.size === 1 ? "" : "s"}`}
              />
              <span className="text-[11px] font-semibold tabular" style={{ color: "var(--glass-text-tertiary)" }}>{b.size}</span>
            </div>
          ))}
        </div>
        <p className="text-[11px] mt-2 text-glass-text-tertiary">Roster size (players registered) →</p>
      </div>
    </section>
  );
}

export default async function LocationDetailPage({
  searchParams,
}: {
  searchParams: Promise<{ loc?: string; season?: string }>;
}) {
  await requireUser();
  const { loc, season } = await searchParams;

  if (!loc || !season) {
    return (
      <main className="brodie-fade-in space-y-4">
        <Link href="/registrations" className="text-sm text-glass-text-tertiary hover:text-glass-text transition">← Back to registrations</Link>
        <p className="text-sm text-glass-text-secondary">Missing location or season.</p>
      </main>
    );
  }

  const data = await loadBreakdown(loc, season);
  const prevLabel = shortSeason(data?.seasons.prev_season ?? "");
  const yearLabel = shortSeason(data?.seasons.prev_year ?? "");

  // Totals across days (should match the location card).
  const total = (data?.days ?? []).reduce(
    (a, d) => ({
      current: { teams: a.current.teams + d.current.teams, athletes: a.current.athletes + d.current.athletes },
      prev_season: { teams: a.prev_season.teams + d.prev_season.teams, athletes: a.prev_season.athletes + d.prev_season.athletes },
      prev_year: { teams: a.prev_year.teams + d.prev_year.teams, athletes: a.prev_year.athletes + d.prev_year.athletes },
    }),
    { current: { teams: 0, athletes: 0 }, prev_season: { teams: 0, athletes: 0 }, prev_year: { teams: 0, athletes: 0 } },
  );

  const avgOf = (c: Cell) => (c.teams ? c.athletes / c.teams : null);

  return (
    <main className="brodie-fade-in space-y-6">
      <div>
        <Link href="/registrations" className="text-sm text-glass-text-tertiary hover:text-glass-text transition">← Back to registrations</Link>
        <p className="font-mono text-xs uppercase tracking-[0.18em] mt-3 mb-1" style={{ color: "var(--glass-gold)" }}>Registrations · {loc}</p>
        <h1 className="text-3xl font-semibold tracking-tight" style={{ color: "var(--glass-text)" }}>By day of week</h1>
        <p className="text-sm mt-1 text-glass-text-secondary">
          Teams, athletes, and players per team for {loc} by night, {season}
          {data?.day_n != null ? ` · day ${data.day_n} of registration` : ""}. Deltas vs {data?.seasons.prev_season ?? "prev season"} and {data?.seasons.prev_year ?? "last year"}, same day.
        </p>
      </div>

      {!data || data.days.length === 0 ? (
        <p className="text-sm italic text-glass-text-tertiary py-8">No registration data for this location and season yet.</p>
      ) : (
        <div className="rounded-2xl border border-glass-border bg-glass-surface overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-[0.18em] text-glass-text-tertiary border-b border-glass-border-light">
                <th className="px-5 py-3 font-bold">Day</th>
                <th className="px-5 py-3 font-bold">Teams</th>
                <th className="px-5 py-3 font-bold">Athletes</th>
                <th className="px-5 py-3 font-bold">Players / team</th>
              </tr>
            </thead>
            <tbody>
              {data.days.map((d) => {
                const avg = avgOf(d.current);
                return (
                  <tr key={d.day} className="border-t border-glass-border-light align-top">
                    <td className="px-5 py-3 font-semibold" style={{ color: "var(--glass-text)" }}>{d.day}</td>
                    <td className="px-5 py-3">
                      <Metric cur={d.current.teams} prev={d.prev_season.teams} year={d.prev_year.teams} prevLabel={prevLabel} yearLabel={yearLabel} />
                    </td>
                    <td className="px-5 py-3">
                      <Metric cur={d.current.athletes} prev={d.prev_season.athletes} year={d.prev_year.athletes} prevLabel={prevLabel} yearLabel={yearLabel} />
                    </td>
                    <td className="px-5 py-3 text-lg font-bold tabular" style={{ color: avgColor(avg) }}>
                      {avg === null ? "—" : avg.toFixed(1)}
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-glass-border align-top bg-glass-surface-hover">
                <td className="px-5 py-3 font-bold uppercase text-[11px] tracking-[0.16em] text-glass-text-secondary">Total</td>
                <td className="px-5 py-3">
                  <Metric cur={total.current.teams} prev={total.prev_season.teams} year={total.prev_year.teams} prevLabel={prevLabel} yearLabel={yearLabel} />
                </td>
                <td className="px-5 py-3">
                  <Metric cur={total.current.athletes} prev={total.prev_season.athletes} year={total.prev_year.athletes} prevLabel={prevLabel} yearLabel={yearLabel} />
                </td>
                <td className="px-5 py-3 text-lg font-bold tabular" style={{ color: avgColor(avgOf(total.current)) }}>
                  {avgOf(total.current) === null ? "—" : avgOf(total.current)!.toFixed(1)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {data?.roster_sizes?.length ? <RosterChart sizes={data.roster_sizes} season={season} /> : null}
    </main>
  );
}
