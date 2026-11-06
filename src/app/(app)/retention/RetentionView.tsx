import { locParam, shortSeason } from "@/lib/seasons";
import { promoFetch } from "@/lib/promo-feed";

// Retention: every location ranked on the measure picked, as horizontal bars.
// Read from the registration-pacing feed the Registrations page uses, at the
// same day N of registration, one request for all four measures:
// - Played Brodie before / within the last year: of this season's captains
//   and athletes at the location, how many had a registration in an earlier
//   season (any, or one of the four before). Locations in their first season
//   are left out, as on the season cards: nobody could have played them.
// - Captains / athletes returning: of the location's players last season,
//   how many registered again, in any role at any Brodie venue; beside it the
//   same a year earlier.
const PROMO_APP_URL = process.env.PROMO_APP_URL ?? "https://registration-promo-tracker.vercel.app";

export type Metric = "before" | "year" | "captains" | "athletes";
export type Sort = "size" | "name";
export const METRICS: { value: Metric; label: string }[] = [
  { value: "before", label: "Played Brodie before" },
  { value: "year", label: "Played Brodie within the last year" },
  { value: "captains", label: "Captains returning" },
  { value: "athletes", label: "Athletes returning" },
];

type Played = {
  returning_captains_pct?: number | null; returning_athletes_pct?: number | null;
  returning_captains?: number | null; returning_captains_of?: number | null;
  returning_athletes?: number | null; returning_athletes_of?: number | null;
  recent_captains_pct?: number | null; recent_athletes_pct?: number | null;
  recent_captains?: number | null; recent_athletes?: number | null;
};
type Season = Played & { season: string; kind: string };
type Retention = { pct: number; prev_athletes: number; retained: number; prev_season: string; into_season?: string } | null;
type Returned = {
  retention?: Retention; retention_year?: Retention;
  retention_captains?: Retention; retention_captains_year?: Retention;
};
type Loc = Returned & { location: string; first_season?: boolean; seasons: Season[] };
type Feed = Returned & { seasons?: Season[]; locations?: Loc[] };

async function loadFeed(season: string, locationNames: string[] | null): Promise<Feed | null> {
  try {
    const url = new URL("/api/registration-pacing", PROMO_APP_URL);
    url.searchParams.set("season", season);
    url.searchParams.set("breakdown", "location");
    const lp = locParam(locationNames);
    if (lp) url.searchParams.set("location", lp);
    const res = await promoFetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as Feed;
    return Array.isArray(k.locations) ? k : null;
  } catch {
    return null;
  }
}

type Bar = { name: string; pct: number; n: number; of: number };
type Chart = {
  title: string;
  subtitle: string;
  bars: Bar[];
  // Every location in scope together, drawn as a dashed line on each bar.
  overall: Bar | null;
  // This season in Brodie red, a year earlier in grey, as on every chart.
  color: string;
};

const pctOf = (n: number, of: number) => Math.round((1000 * n) / of) / 10;

export default async function RetentionView({ season, locationNames, metric, sort }: {
  season: string; locationNames: string[] | null; metric: Metric; sort: Sort;
}) {
  const feed = await loadFeed(season, locationNames);
  if (!feed) {
    return (
      <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm text-glass-text-tertiary shadow-card">
        <span className="font-semibold" style={{ color: "var(--glass-text-secondary)" }}>Not connected.</span>{" "}
        League Health couldn&apos;t load registrations from the Promo Tracker, so no retention is shown.
      </div>
    );
  }

  const locs = feed.locations ?? [];
  const cur = (s?: Season[]) => s?.find((x) => x.kind === "current");
  const short = shortSeason(season);

  // Played before (ever, or within the last year) for one population.
  const playedChart = (noun: "captains" | "athletes", recent: boolean): Chart => {
    const cap = noun === "captains";
    const nKey = recent ? (cap ? "recent_captains" : "recent_athletes") : (cap ? "returning_captains" : "returning_athletes");
    const ofKey = cap ? "returning_captains_of" : "returning_athletes_of";
    const bar = (name: string, s?: Season): Bar | null => {
      const n = s?.[nKey], of = s?.[ofKey];
      return n != null && of ? { name, n, of, pct: pctOf(n, of) } : null;
    };
    return {
      title: cap ? "Captains" : "Athletes",
      subtitle: recent
        ? `Share of ${short} ${noun} who played in one of the four seasons before`
        : `Share of ${short} ${noun} who had played Brodie before`,
      bars: locs.filter((l) => !l.first_season).map((l) => bar(l.location, cur(l.seasons))).filter((b): b is Bar => !!b),
      overall: bar("All locations", cur(feed.seasons)),
      color: "var(--viz-now)",
    };
  };
  // Returned, this season or a year earlier, for one population.
  const returnedChart = (noun: "captains" | "athletes", yearBack: boolean): Chart => {
    const key = noun === "captains"
      ? (yearBack ? "retention_captains_year" : "retention_captains")
      : (yearBack ? "retention_year" : "retention");
    const bar = (name: string, r?: Retention): Bar | null =>
      r && r.prev_athletes ? { name, n: r.retained, of: r.prev_athletes, pct: r.pct } : null;
    const sample = feed[key] ?? locs.map((l) => l[key]).find(Boolean) ?? null;
    const from = sample ? shortSeason(sample.prev_season) : yearBack ? "last year's" : "last season's";
    const into = sample?.into_season ? shortSeason(sample.into_season) : yearBack ? "a year ago" : short;
    return {
      title: yearBack ? "A year earlier" : "This season",
      subtitle: `${from} ${noun} back in ${into}`,
      bars: locs.map((l) => bar(l.location, l[key] ?? undefined)).filter((b): b is Bar => !!b),
      overall: bar("All locations", feed[key] ?? undefined),
      color: yearBack ? "var(--viz-prev)" : "var(--viz-now)",
    };
  };

  const charts: Chart[] = metric === "before" ? [playedChart("captains", false), playedChart("athletes", false)]
    : metric === "year" ? [playedChart("captains", true), playedChart("athletes", true)]
    : metric === "captains" ? [returnedChart("captains", false), returnedChart("captains", true)]
    : [returnedChart("athletes", false), returnedChart("athletes", true)];

  const ordered = (bars: Bar[]) => [...bars].sort((a, b) => sort === "name"
    ? a.name.localeCompare(b.name)
    // Ties go to the bigger base, then the name.
    : b.pct - a.pct || b.of - a.of || a.name.localeCompare(b.name));

  const firstSeason = locs.filter((l) => l.first_season).map((l) => l.location).sort((a, b) => a.localeCompare(b));
  const played = metric === "before" || metric === "year";

  return (
    <div className="space-y-4">
      {played && firstSeason.length > 0 && (
        <p className="text-sm text-glass-text-secondary max-w-[90ch]">
          Leaves out the {firstSeason.length} {firstSeason.length === 1 ? "location" : "locations"} in their first
          season, where nobody could have played before: {firstSeason.join(", ")}.
        </p>
      )}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        {charts.map((c) => (
          <section key={c.title} className="rounded-2xl bg-glass-surface p-5 shadow-card min-w-0">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
              <div className="min-w-0">
                <h2 className="text-base font-semibold" style={{ color: "var(--glass-text)" }}>{c.title}</h2>
                <p className="text-xs mt-0.5 text-glass-text-tertiary">{c.subtitle}</p>
              </div>
              {c.overall && (
                <p className="text-xs text-glass-text-tertiary tabular flex items-center gap-1.5">
                  <span aria-hidden className="inline-block h-3 border-l border-dashed" style={{ borderColor: "var(--glass-text-secondary)" }} />
                  All locations{" "}
                  <span className="font-semibold" style={{ color: "var(--glass-text)" }}>{c.overall.pct.toFixed(1)}%</span>
                  <span>· {c.overall.n.toLocaleString()} of {c.overall.of.toLocaleString()}</span>
                </p>
              )}
            </div>
            {c.bars.length === 0 ? (
              <p className="mt-4 text-sm italic text-glass-text-tertiary">No locations to rank in this scope yet.</p>
            ) : (
              <ol className="mt-4 space-y-1.5">
                {ordered(c.bars).map((b) => (
                  <li key={b.name}
                    className="grid items-center gap-3 grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_4.75rem] sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_5.5rem]">
                    <span className="truncate text-[13px] font-medium" style={{ color: "var(--glass-text)" }} title={b.name}>
                      {b.name}
                    </span>
                    <div className="relative h-4 rounded" style={{ background: "var(--fill-3)" }}>
                      <div className="h-full rounded" style={{ width: `${Math.min(100, b.pct)}%`, background: c.color }} />
                      {c.overall && (
                        <div aria-hidden className="absolute -top-0.5 -bottom-0.5 border-l border-dashed"
                          style={{ left: `${Math.min(100, c.overall.pct)}%`, borderColor: "var(--glass-text-secondary)" }} />
                      )}
                    </div>
                    <span className="text-right tabular leading-tight" title={`${b.n} of ${b.of}`}>
                      <span className="block text-[13px] font-semibold" style={{ color: "var(--glass-text)" }}>{b.pct.toFixed(1)}%</span>
                      <span className="block text-[11px] text-glass-text-tertiary">{b.n.toLocaleString()} of {b.of.toLocaleString()}</span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        ))}
      </div>
      <p className="text-xs text-glass-text-tertiary max-w-[90ch]">
        {season} at the same day of registration as the Registrations page. Played Brodie before is the share of this
        season&apos;s captains or athletes at a location who had a completed registration in any earlier season;
        within the last year counts only the four seasons before this one. Locations in their first season are left
        out of both. Captains and athletes returning are the share of a location&apos;s players last season who have
        registered again by the same day, in any role at any Brodie venue; a year earlier asks the same of the
        season before, one year back. The dashed line is every location in scope together. A small location can rank
        high on a handful of people, so each bar shows its count.
      </p>
    </div>
  );
}
