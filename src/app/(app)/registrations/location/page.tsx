import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getAssignableLocations, getRegistrationSeasons } from "@/lib/locations";
import { DetailFilters } from "./DetailFilters";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PROMO_URL = "https://registration-promo-tracker.vercel.app";

const BACK_BTN =
  "inline-flex items-center gap-1.5 rounded-lg border border-glass-border bg-glass-surface px-3.5 py-2 text-sm font-medium text-glass-text hover:bg-glass-surface-hover hover:border-glass-gold transition";

type Cell = { teams: number; athletes: number };
type DayRow = { day: string; current: Cell; prev_season: Cell; prev_year: Cell };
type RosterSize = { roster_size: number; team_count: number };
type RosterDay = { day: string; sizes: RosterSize[] };
type Breakdown = {
  location: string;
  day_n: number | null;
  seasons: { current: string; prev_season: string; prev_year: string };
  days: DayRow[];
  roster_sizes: RosterSize[];
  roster_by_day: RosterDay[];
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

// Horizontal bar chart of teams per roster size: one row per roster size
// (the y-axis), bar length = number of teams. xMin..xMax + maxCount are passed
// in so several charts (the daily small multiples) share one scale.
function RosterBars({ sizes, xMin, xMax, maxCount, barH = 14 }: {
  sizes: RosterSize[]; xMin: number; xMax: number; maxCount: number; barH?: number;
}) {
  const countBy = new Map(sizes.map((s) => [s.roster_size, s.team_count]));
  const rows: { size: number; count: number }[] = [];
  for (let n = xMin; n <= xMax; n++) rows.push({ size: n, count: countBy.get(n) ?? 0 });
  const mx = Math.max(1, maxCount);
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.size} className="flex items-center gap-2" title={`${r.count} team${r.count === 1 ? "" : "s"} with ${r.size} player${r.size === 1 ? "" : "s"}`}>
          <span className="w-4 text-right text-[11px] font-semibold tabular shrink-0" style={{ color: "var(--glass-text-tertiary)" }}>{r.size}</span>
          <div className="flex-1 rounded" style={{ height: barH, background: "var(--glass-surface-hover)" }}>
            <div className="h-full rounded" style={{ width: `${(r.count / mx) * 100}%`, background: r.count > 0 ? "var(--glass-gold)" : "transparent" }} />
          </div>
          <span className="w-6 text-right text-[11px] font-semibold tabular shrink-0" style={{ color: "var(--glass-text-secondary)" }}>{r.count || ""}</span>
        </div>
      ))}
    </div>
  );
}

const sum = (sizes: RosterSize[]) => sizes.reduce((a, s) => a + s.team_count, 0);

function RosterCharts({ totals, byDay, season }: { totals: RosterSize[]; byDay: RosterDay[]; season: string }) {
  if (!totals.length) return null;
  const xMin = Math.min(...totals.map((s) => s.roster_size));
  const xMax = Math.max(...totals.map((s) => s.roster_size));
  // Daily charts share one length scale (max count across all days) so bar
  // lengths are comparable night to night.
  const dayMaxCount = Math.max(1, ...byDay.flatMap((d) => d.sizes.map((s) => s.team_count)));

  return (
    <>
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: "var(--glass-text)" }}>Players registered per team</h2>
          <p className="text-sm text-glass-text-secondary">How many teams have each roster size · {season} · {sum(totals).toLocaleString()} teams</p>
        </div>
        <div className="rounded-2xl border border-glass-border bg-glass-surface p-5">
          <RosterBars sizes={totals} xMin={xMin} xMax={xMax} maxCount={Math.max(...totals.map((s) => s.team_count))} barH={18} />
          <p className="text-[11px] mt-3 text-glass-text-tertiary">Roster size (players registered) ↓ · bar length = teams</p>
        </div>
      </section>

      {byDay.length ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold" style={{ color: "var(--glass-text)" }}>Players per team by day</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {byDay.map((d) => (
              <div key={d.day} className="rounded-2xl border border-glass-border bg-glass-surface p-4">
                <div className="flex items-baseline justify-between mb-2">
                  <span className="text-sm font-semibold" style={{ color: "var(--glass-text)" }}>{d.day}</span>
                  <span className="text-xs text-glass-text-tertiary">{sum(d.sizes).toLocaleString()} teams</span>
                </div>
                <RosterBars sizes={d.sizes} xMin={xMin} xMax={xMax} maxCount={dayMaxCount} />
              </div>
            ))}
          </div>
          <p className="text-[11px] text-glass-text-tertiary">Roster size (players registered) ↓ · bar length = teams · shared scale across days</p>
        </section>
      ) : null}
    </>
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
        <Link href="/registrations" className={BACK_BTN}>← Back to registrations</Link>
        <p className="text-sm text-glass-text-secondary">Missing location or season.</p>
      </main>
    );
  }

  const [data, allLocations, allSeasons] = await Promise.all([
    loadBreakdown(loc, season),
    getAssignableLocations(),
    getRegistrationSeasons(),
  ]);
  // Make sure the current selection is always in the dropdowns — split-league
  // cards (e.g. "Calgary (North)") aren't in the promo location list.
  const locations = allLocations.includes(loc) ? allLocations : [loc, ...allLocations];
  const seasons = allSeasons.includes(season) ? allSeasons : [season, ...allSeasons];
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
        <Link href="/registrations" className={BACK_BTN}>← Back to registrations</Link>
        <p className="font-mono text-xs uppercase tracking-[0.18em] mt-4 mb-1" style={{ color: "var(--glass-gold)" }}>Registrations · {loc}</p>
        <h1 className="text-3xl font-semibold tracking-tight" style={{ color: "var(--glass-text)" }}>By day of week</h1>
        <p className="text-sm mt-1 text-glass-text-secondary">
          Teams, athletes, and players per team for {loc} by night, {season}
          {data?.day_n != null ? ` · day ${data.day_n} of registration` : ""}. Deltas vs {data?.seasons.prev_season ?? "prev season"} and {data?.seasons.prev_year ?? "last year"}, same day.
        </p>
      </div>

      <DetailFilters loc={loc} season={season} locations={locations} seasons={seasons} />

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

      {data?.roster_sizes?.length ? (
        <RosterCharts totals={data.roster_sizes} byDay={data.roster_by_day ?? []} season={season} />
      ) : null}
    </main>
  );
}
