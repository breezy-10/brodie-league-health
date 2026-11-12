import { locParam } from "@/lib/seasons";
import { promoFetch } from "@/lib/promo-feed";
import { BasisToggle } from "./BasisToggle";
import RegHistoryCharts, { type HistBar as Bar } from "./RegHistoryCharts";

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
// Under them, retention: of the season before's athletes, the share who
// registered again (any role, any Brodie venue), read the same way; the
// Retention page's "Athletes returning", so the season picked matches it.
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
  // Of the season before's athletes (and captains), how many came back. Null
  // where the season before had nobody in scope; absent from an older feed.
  retention?: {
    prev_season: string | null;
    prev_athletes: number; prev_captains: number;
    back_final: number; captains_back_final: number;
    back_to_date: number | null; captains_back_to_date: number | null;
  } | null;
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
  // Retention: of the season before's athletes, the share back this season,
  // and the counts and captains behind it on hover.
  const pctOf = (n: number, of: number) => (100 * n) / of;
  const retention: Bar[] = feed.seasons.flatMap((s) => {
    const r = s.retention;
    const back = toDate ? r?.back_to_date : r?.back_final;
    const capsBack = (toDate ? r?.captains_back_to_date : r?.captains_back_final) ?? 0;
    if (!r || back == null || !r.prev_athletes) return [];
    return [{
      season: s.season, value: pctOf(back, r.prev_athletes), locations: null,
      details: [
        { label: `Athletes from ${r.prev_season ?? "the season before"}`, value: `${back.toLocaleString()} of ${r.prev_athletes.toLocaleString()}` },
        { label: "Captains back", value: r.prev_captains
          ? `${capsBack.toLocaleString()} of ${r.prev_captains.toLocaleString()} (${pctOf(capsBack, r.prev_captains).toFixed(1)}%)` : "–" },
      ],
    }];
  });
  const day = feed.day_n;
  const subtitle = (noun: string) => toDate
    ? `${noun} at day ${day ?? "N"} of registration, every season`
    : `Final ${noun.toLowerCase()} for every season`;

  const hasRetention = feed.seasons.some((s) => s.retention !== undefined);

  return (
    <div className="space-y-4">
      <RegHistoryCharts season={season} toggle={toggle}
        intro={toDate && feed.to_date_from ? (
          <p className="text-sm text-glass-text-secondary max-w-[90ch]">
            Starts at {feed.to_date_from}: seasons before it were moved onto the platform in bulk, so their records
            don&apos;t say when anyone signed up and there is no day {day ?? "N"} to read. Final shows every season.
          </p>
        ) : undefined}
        charts={[
          { title: "Teams", noun: "teams", subtitle: subtitle("Teams"), bars: pick("teams") },
          { title: "Athletes", noun: "athletes", subtitle: subtitle("Athletes"), bars: pick("athletes") },
          // Only once the feed carries retention: an older one has none.
          ...(hasRetention ? [{
            title: "Retention", noun: "retention", percent: true, bars: retention,
            subtitle: toDate
              ? `Share of the season before's athletes registered again by day ${day ?? "N"}, every season`
              : "Share of the season before's athletes who registered again, every season",
          }] : []),
        ]} />
      <p className="text-xs text-glass-text-tertiary max-w-[90ch]">
        Oldest season on the left, {season} on the right, each bar coloured by its term; click a term in the key to
        show only its seasons (several can be picked, and clicking one again puts it back). Final is how each season ended up: teams are slots on
        the schedule, as on the Metabase registration dashboard (for each location and day, the most teams that played
        there in any one week, so a team that took over a slot part-way through or a TBD stand-in for a late team
        doesn&apos;t count twice, and all-star teams are left out); athletes are the registrations still standing. A
        season not played yet shows what is registered so far. So a season&apos;s final teams can sit below its count
        to date, which still has the teams that registered and later folded or merged. To date reads every season at
        day {day ?? "N"} of its own registration, the day {season} is at now, counted as on the Registrations tab.
        Hover a bar (or tab to it) for its change against the season before it on the chart and the same season a
        year earlier, and how many of its locations were new against each: final, locations whose teams played; to
        date, locations with a team in by that day.
        {hasRetention && (
          <>
            {" "}Retention is the Retention page&apos;s athletes returning, for every season: of the athletes still
            registered the season before (the previous term, so Fall for Winter; each counted once, at the locations
            in scope), the share who registered again, in any role at any Brodie venue. Final counts those whose
            registration is still standing; to date, those in by day {day ?? "N"} of the season&apos;s registration and
            not cancelled by then. A season whose previous term had nobody here has no bar. Changes on hover are in
            points; the counts and the captains who came back are under them.
          </>
        )}
      </p>
    </div>
  );
}
