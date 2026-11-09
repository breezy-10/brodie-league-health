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

// Bars are coloured by term, so every summer reads alike and so on; the legend
// names them and every bar carries its season under it.
const TERM_COLORS: { term: string; color: string }[] = [
  { term: "Winter", color: "var(--viz-winter)" },
  { term: "Spring", color: "var(--viz-spring)" },
  { term: "Summer", color: "var(--viz-summer)" },
  { term: "Fall", color: "var(--viz-fall)" },
];
const termColor = (season: string) =>
  TERM_COLORS.find((t) => season.toLowerCase().startsWith(t.term.toLowerCase()))?.color ?? "var(--viz-prev)";

const TRACK_PX = 150;
// Wide enough for "Summer '26" under its bar; narrower screens scroll the chart.
const COL_PX = 64;

function HistoryChart({ title, subtitle, season, bars }: {
  title: string;
  subtitle: string;
  season: string;
  bars: { season: string; value: number }[];
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
            <div className="flex items-end gap-2" style={{ height: TRACK_PX + 22 }}>
              {bars.map((b) => (
                <div key={b.season} className="flex-1 flex flex-col items-center justify-end" title={`${b.season}: ${b.value.toLocaleString()}`}>
                  <span className="text-[11px] font-semibold tabular mb-1" style={{ color: "var(--glass-text)" }}>{b.value.toLocaleString()}</span>
                  <div className="w-full rounded-t" style={{
                    height: Math.max(Math.round((b.value / max) * TRACK_PX), 4),
                    background: termColor(b.season),
                  }} />
                </div>
              ))}
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
  const pick = (k: "teams" | "athletes") => feed.seasons
    .map((s) => ({ season: s.season, value: toDate ? s[`${k}_to_date`] : s[`${k}_final`] }))
    .filter((b): b is { season: string; value: number } => b.value != null);
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
      <HistoryChart title="Teams" subtitle={subtitle("Teams")} season={season} bars={pick("teams")} />
      <HistoryChart title="Athletes" subtitle={subtitle("Athletes")} season={season} bars={pick("athletes")} />
      <p className="text-xs text-glass-text-tertiary max-w-[90ch]">
        Oldest season on the left, {season} on the right, each bar coloured by its term. Final is how each season ended up: teams are slots on
        the schedule, as on the Metabase registration dashboard (for each location and day, the most teams that played
        there in any one week, so a team that took over a slot part-way through or a TBD stand-in for a late team
        doesn&apos;t count twice, and all-star teams are left out); athletes are the registrations still standing. A
        season not played yet shows what is registered so far. So a season&apos;s final teams can sit below its count
        to date, which still has the teams that registered and later folded or merged. To date reads every season at
        day {day ?? "N"} of its own registration, the day {season} is at now, counted as on the Registrations tab.
      </p>
    </div>
  );
}
