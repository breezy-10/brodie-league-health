import { locParam } from "@/lib/seasons";
import { promoFetch } from "@/lib/promo-feed";
import { BasisToggle } from "./BasisToggle";

// Registrations > Historical teams: teams and athletes for every season, oldest
// on the left and the season picked on the right, from the Promo Tracker's
// registration-history feed. Two readings:
//   - Final: how each season ended up. Teams are slots on the schedule (the
//     Metabase dashboard's Registered Team Count rule: for each location and
//     day that played, the most teams that played there in one week, so a
//     replacement team or a TBD stand-in doesn't add one, and no all-star
//     teams); athletes are those still registered. A season not yet played
//     shows what is registered.
//   - To date: every season at the same day of registration as the season
//     picked is at now, counted as on the Registrations tab. Only seasons
//     whose records say when people signed up (the feed's to_date_from on).
const PROMO_APP_URL = process.env.PROMO_APP_URL ?? "https://registration-promo-tracker.vercel.app";

type HistSeason = {
  season: string;
  teams_to_date: number | null;
  athletes_to_date: number | null;
  teams_final: number | null;
  athletes_final: number | null;
  // Ops league ids, to count new locations against another season.
  locations_to_date?: string[] | null;
  locations_final?: string[];
};
type Feed = { season: string; day_n: number | null; to_date_from?: string; seasons: HistSeason[] };

async function loadHistory(season: string, locationNames: string[] | null): Promise<Feed | null> {
  try {
    const url = new URL("/api/registration-history", PROMO_APP_URL);
    url.searchParams.set("season", season);
    const lp = locParam(locationNames);
    if (lp) url.searchParams.set("location", lp);
    const res = await promoFetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as Feed;
    return Array.isArray(k.seasons) ? k : null;
  } catch {
    return null;
  }
}

type Basis = "final" | "todate";
const BASES: { value: Basis; label: string }[] = [
  { value: "final", label: "Final" },
  { value: "todate", label: "To date" },
];

// Bars are coloured by term in Brodie's seasonal colours (winter blue, spring
// green, summer yellow, fall red), so every summer reads alike and so on; the
// legend names them and every bar carries its season under it.
const TERM_COLORS: { term: string; color: string }[] = [
  { term: "Winter", color: "var(--viz-winter)" },
  { term: "Spring", color: "var(--viz-spring)" },
  { term: "Summer", color: "var(--viz-summer)" },
  { term: "Fall", color: "var(--viz-fall)" },
];
const termColor = (season: string) =>
  TERM_COLORS.find((t) => season.toLowerCase().startsWith(t.term.toLowerCase()))?.color ?? "var(--viz-prev)";

// The same term a year earlier: Summer '24 for Summer '25.
function yearBefore(season: string): string | null {
  const m = season.match(/^(\S+) '(\d{2})$/);
  return m ? `${m[1]} '${String(Number(m[2]) - 1).padStart(2, "0")}` : null;
}
// Change against the season compared with: the count, then as a share of
// that season, one decimal, both signed: "+210 (+48.4%)". Up is green and down
// red (the status colours, which brighten in dark mode); no change stays ink.
function change(value: number, against: number | undefined): { text: string; color?: string } {
  if (!against) return { text: "–" };
  const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "");
  const n = value - against;
  const d = (100 * n) / against;
  return {
    text: `${sign(n)}${Math.abs(n).toLocaleString()} (${sign(d)}${Math.abs(d).toFixed(1)}%)`,
    color: n > 0 ? "var(--glass-success-text)" : n < 0 ? "var(--glass-danger-text)" : undefined,
  };
}
// Locations in this season that the season compared with didn't have.
function newLocations(locs: string[] | null, against: string[] | null | undefined): string {
  if (!locs || !against) return "–";
  const had = new Set(against);
  return locs.filter((id) => !had.has(id)).length.toLocaleString();
}

type Bar = { season: string; value: number; locations: string[] | null };

const TRACK_PX = 150;
// Wide enough for "Summer '26" under its bar; narrower screens scroll the chart.
const COL_PX = 64;

function TipRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 whitespace-nowrap">
      <span>{label}</span>
      <span className="tabular font-semibold" style={{ color: color ?? "var(--ink)" }}>{value}</span>
    </div>
  );
}

function HistoryChart({ title, noun, subtitle, season, bars }: {
  title: string;
  noun: string;
  subtitle: string;
  season: string;
  bars: Bar[];
}) {
  const max = Math.max(...bars.map((b) => b.value), 1);
  const current = bars.find((b) => b.season === season);
  return (
    <section className="rounded-2xl bg-glass-surface p-5 shadow-card min-w-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold" style={{ color: "var(--glass-text)" }}>{title}</h3>
          <p className="text-xs mt-0.5 text-glass-text-tertiary">{subtitle}</p>
        </div>
        {current && (
          <div className="text-right shrink-0">
            <span className="text-2xl font-bold tabular block" style={{ color: "var(--glass-gold)" }}>{current.value.toLocaleString()}</span>
            <span className="text-[11px] text-glass-text-tertiary">{season}</span>
          </div>
        )}
      </div>
      {bars.length === 0 ? (
        <p className="mt-4 text-sm italic text-glass-text-tertiary">No seasons to show in this scope.</p>
      ) : (
        <div className="overflow-x-auto mt-5">
          <div style={{ minWidth: bars.length * COL_PX }}>
            {/* Bars: fixed-px track so heights are truly proportional to value. */}
            <div className="flex items-stretch gap-2" style={{ height: TRACK_PX + 22 }}>
              {bars.map((b, i) => {
                // Against the season before it on the chart, and the same term a
                // year earlier. On hover or focus, beside the bar and inside the
                // track (the scroll box would clip it above), flipping left near
                // the right edge.
                const prev = i > 0 ? bars[i - 1] : undefined;
                const lastYearName = yearBefore(b.season);
                const lastYear = bars.find((x) => x.season === lastYearName);
                const vsPrev = change(b.value, prev?.value), vsYear = change(b.value, lastYear?.value);
                return (
                  <div key={b.season} tabIndex={0} aria-label={`${b.season}: ${b.value.toLocaleString()} ${noun}`}
                    className="group relative flex-1 flex flex-col items-center justify-end outline-none">
                    <span className="text-[11px] font-semibold tabular mb-1" style={{ color: "var(--glass-text)" }}>{b.value.toLocaleString()}</span>
                    <div className="w-full rounded-t group-hover:opacity-80 group-focus-visible:opacity-80" style={{
                      height: Math.max(Math.round((b.value / max) * TRACK_PX), 4),
                      background: termColor(b.season),
                    }} />
                    <div role="tooltip"
                      className={`br-chart-tip hidden group-hover:block group-focus-visible:block top-0 z-10 ${i >= bars.length - 3 ? "right-full mr-1" : "left-full ml-1"}`}>
                      <b>{b.season}</b>
                      <TipRow label={noun[0].toUpperCase() + noun.slice(1)} value={b.value.toLocaleString()} />
                      <TipRow label={`vs ${prev?.season ?? "season before"}`} value={vsPrev.text} color={vsPrev.color} />
                      <TipRow label={`vs ${lastYearName ?? "a year earlier"}`} value={vsYear.text} color={vsYear.color} />
                      <div className="my-1.5" style={{ borderTop: "1px solid var(--divider)" }} />
                      <TipRow label="Locations" value={b.locations ? b.locations.length.toLocaleString() : "–"} />
                      <TipRow label={`New vs ${prev?.season ?? "season before"}`} value={prev ? newLocations(b.locations, prev.locations) : "–"} />
                      <TipRow label={`New vs ${lastYearName ?? "a year earlier"}`} value={lastYear ? newLocations(b.locations, lastYear.locations) : "–"} />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-2 mt-2">
              {bars.map((b) => (
                // The season picked stands out by its label, its colour being its term's.
                <span key={b.season} className={`flex-1 text-center text-[11px] whitespace-nowrap ${b.season === season ? "font-bold" : "font-semibold text-glass-text-secondary"}`}
                  style={b.season === season ? { color: "var(--glass-text)" } : undefined}>
                  {b.season}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function TermLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-glass-text-secondary">
      {TERM_COLORS.map((t) => (
        <span key={t.term} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: t.color }} />
          {t.term}
        </span>
      ))}
    </div>
  );
}

export default async function RegHistory({ season, locationNames, basis }: {
  season: string; locationNames: string[] | null; basis?: string;
}) {
  const which: Basis = basis === "todate" ? "todate" : "final";
  const toggle = <BasisToggle param="hist" value={which} options={BASES} />;
  const feed = await loadHistory(season, locationNames);
  if (!feed) {
    return (
      <div className="space-y-4">
        <div>{toggle}</div>
        <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm text-glass-text-tertiary shadow-card">
          <span className="font-semibold" style={{ color: "var(--glass-text-secondary)" }}>Not connected.</span>{" "}
          League Health couldn&apos;t load the registration history from the Promo Tracker, so no history is shown.
        </div>
      </div>
    );
  }

  const toDate = which === "todate";
  const pick = (k: "teams" | "athletes"): Bar[] => feed.seasons
    .map((s) => ({
      season: s.season,
      value: toDate ? s[`${k}_to_date`] : s[`${k}_final`],
      locations: (toDate ? s.locations_to_date : s.locations_final) ?? null,
    }))
    .filter((b): b is Bar => b.value != null);
  const day = feed.day_n;
  const subtitle = (noun: string) => toDate
    ? `${noun} at day ${day ?? "N"} of registration, every season`
    : `Final ${noun.toLowerCase()} for every season`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {toggle}
        <TermLegend />
      </div>
      {toDate && feed.to_date_from && (
        <p className="text-sm text-glass-text-secondary max-w-[90ch]">
          Starts at {feed.to_date_from}: seasons before it were moved onto the platform in bulk, so their records
          don&apos;t say when anyone signed up and there is no day {day ?? "N"} to read. Final shows every season.
        </p>
      )}
      <HistoryChart title="Teams" noun="teams" subtitle={subtitle("Teams")} season={season} bars={pick("teams")} />
      <HistoryChart title="Athletes" noun="athletes" subtitle={subtitle("Athletes")} season={season} bars={pick("athletes")} />
      <p className="text-xs text-glass-text-tertiary max-w-[90ch]">
        Oldest season on the left, {season} on the right, each bar coloured by its term. Final is how each season ended up: teams are slots on
        the schedule, as on the Metabase registration dashboard (for each location and day, the most teams that played
        there in any one week, so a team that took over a slot part-way through or a TBD stand-in for a late team
        doesn&apos;t count twice, and all-star teams are left out); athletes are the registrations still standing. A
        season not played yet shows what is registered so far. So a season&apos;s final teams can sit below its count
        to date, which still has the teams that registered and later folded or merged. To date reads every season at
        day {day ?? "N"} of its own registration, the day {season} is at now, counted as on the Registrations tab.
        Hover a bar (or tab to it) for its change against the season before it on the chart and the same season a
        year earlier, and how many of its locations were new against each: final, locations whose teams played; to
        date, locations with a team in by that day.
      </p>
    </div>
  );
}
