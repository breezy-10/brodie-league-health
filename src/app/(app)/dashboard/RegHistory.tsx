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
  // Revenue per player in each currency (team fees left out), with the
  // revenue and athletes behind it; null where the season has none of that
  // currency's athletes or no invoices (before Spring '25). Absent from an
  // older feed.
  per_player?: Record<"cad_final" | "usd_final" | "cad_to_date" | "usd_to_date",
    { revenue: number; athletes: number; per_player: number } | null>;
};
// played_rule_until: seasons before it are counted from the games (teams
// with 5+ played, players on their rosters); absent from an older feed.
type Feed = { season: string; day_n: number | null; to_date_from?: string; played_rule_until?: string; seasons: HistSeason[] };

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
  // Locations: how many each season had (final, those whose teams played;
  // to date, those with a team in by day N), and on hover which were new
  // against the season before and which of its locations didn't come back.
  const locationBars: Bar[] = (() => {
    const list = feed.seasons
      .filter((s) => (toDate ? s.teams_to_date : s.teams_final) != null)
      .map((s) => ({ season: s.season, ids: (toDate ? s.locations_to_date : s.locations_final) ?? null }))
      .filter((x): x is { season: string; ids: string[] } => !!x.ids && x.ids.length > 0);
    return list.map((x, i) => {
      const prev = list[i - 1];
      const now = new Set(x.ids), before = new Set(prev?.ids ?? []);
      return {
        season: x.season, value: x.ids.length, locations: null,
        details: prev ? [
          { label: `New since ${prev.season}`, value: x.ids.filter((id) => !before.has(id)).length.toLocaleString() },
          { label: `Not back from ${prev.season}`, value: prev.ids.filter((id) => !now.has(id)).length.toLocaleString() },
        ] : [{ label: "First season", value: "–" }],
      };
    });
  })();
  const pick = (k: "teams" | "athletes"): Bar[] => feed.seasons
    .map((s) => ({
      season: s.season,
      value: toDate ? s[`${k}_to_date`] : s[`${k}_final`],
      locations: (toDate ? s.locations_to_date : s.locations_final) ?? null,
    }))
    .filter((b): b is Bar => b.value != null);
  // Retention: of the season before's athletes (or captains), the share
  // back this season in any role, and the counts behind it on hover.
  const pctOf = (n: number, of: number) => (100 * n) / of;
  const retention = (who: "athletes" | "captains"): Bar[] => feed.seasons.flatMap((s) => {
    const r = s.retention;
    if (!r) return [];
    const of = who === "athletes" ? r.prev_athletes : r.prev_captains;
    const back = who === "athletes"
      ? (toDate ? r.back_to_date : r.back_final)
      : (toDate ? r.captains_back_to_date : r.captains_back_final);
    if (back == null || !of) return [];
    return [{
      season: s.season, value: pctOf(back, of), locations: null,
      details: [{
        label: `${who === "athletes" ? "Athletes" : "Captains"} from ${r.prev_season ?? "the season before"}`,
        value: `${back.toLocaleString()} of ${of.toLocaleString()}`,
      }],
    }];
  });
  // Athletes per team: the two bars above divided, on the same reading, with
  // both counts on hover. A season with athletes but no teams has none.
  const perTeam: Bar[] = feed.seasons.flatMap((s) => {
    const a = toDate ? s.athletes_to_date : s.athletes_final;
    const t = toDate ? s.teams_to_date : s.teams_final;
    if (a == null || !t) return [];
    return [{
      season: s.season, value: a / t, locations: null,
      details: [
        { label: "Athletes", value: a.toLocaleString() },
        { label: "Teams", value: t.toLocaleString() },
      ],
    }];
  });
  // Revenue per player in one currency, with the revenue and the players it
  // is divided by on hover.
  const perPlayer = (cur: "cad" | "usd"): Bar[] => feed.seasons.flatMap((s) => {
    const p = s.per_player?.[`${cur}_${toDate ? "to_date" : "final"}`];
    if (!p) return [];
    return [{
      season: s.season, value: p.per_player, locations: null,
      details: [
        { label: "Revenue", value: `$${p.revenue.toLocaleString()} ${cur.toUpperCase()}` },
        { label: "Players", value: p.athletes.toLocaleString() },
      ],
    }];
  });
  const hasPerPlayer = feed.seasons.some((s) => s.per_player !== undefined);
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
          {
            title: "Locations", noun: "locations", bars: locationBars,
            subtitle: toDate
              ? `Locations with a team in by day ${day ?? "N"} of registration, every season`
              : "Locations whose teams played, every season",
          },
          { title: "Teams", noun: "teams", subtitle: subtitle("Teams"), bars: pick("teams") },
          { title: "Athletes", noun: "athletes", subtitle: subtitle("Athletes"), bars: pick("athletes") },
          // Under Athletes: per team, then revenue per player in each
          // currency (Sohaib, Nov 12).
          {
            title: "Athletes per team", noun: "athletes per team", format: "decimal" as const, bars: perTeam,
            subtitle: toDate
              ? `Athletes for each team at day ${day ?? "N"} of registration, every season`
              : "Final athletes for each final team, every season",
          },
          ...(hasPerPlayer ? (["cad", "usd"] as const).map((cur) => ({
            title: `Revenue per player (${cur.toUpperCase()})`, noun: "per player",
            format: "money" as const, currency: cur.toUpperCase(), bars: perPlayer(cur),
            subtitle: `${cur === "cad" ? "Canadian" : "US"} locations, team fees left out, ${toDate ? `at day ${day ?? "N"} of registration` : "final"}, every season since Spring '25`,
          })) : []),
          // Only once the feed carries retention: an older one has none.
          // Captains first, then athletes (Sohaib, Nov 11).
          ...(hasRetention ? (["captains", "athletes"] as const).map((who) => ({
            title: who === "captains" ? "Captain retention" : "Athlete retention",
            noun: "retention", percent: true, bars: retention(who),
            subtitle: toDate
              ? `Share of the season before's ${who} registered again by day ${day ?? "N"}, every season`
              : `Share of the season before's ${who} who registered again, every season`,
          })) : []),
        ]} />
      <p className="text-xs text-glass-text-tertiary max-w-[90ch]">
        Oldest season on the left, {season} on the right, each bar coloured by its term; click a term in the key to
        show only its seasons (several can be picked, and clicking one again puts it back). Locations are venues as
        ops runs them (a city with several, like Calgary, counts each): final, those whose teams played (or, a season
        not played yet, have teams registered); to date, those with a team in by that day. Final is how each season ended up: teams are slots on
        the schedule, as on the Metabase registration dashboard (for each location and day, the most teams that played
        there in any one week, so a team that took over a slot part-way through or a TBD stand-in for a late team
        doesn&apos;t count twice, and all-star teams are left out); athletes are the registrations still standing. A
        season not played yet shows what is registered so far. So a season&apos;s final teams can sit below its count
        to date, which still has the teams that registered and later folded or merged. To date reads every season at
        day {day ?? "N"} of its own registration, the day {season} is at now, counted as on the Registrations tab.
        Hover a bar (or tab to it) for its change against the season before it (whichever terms are showing) and the
        same season a year earlier, and how many of its locations were new against each: final, locations whose teams played; to
        date, locations with a team in by that day. Athletes per team divides the two bars above it.
        {hasPerPlayer && (
          <>
            {" "}Revenue per player is the Registrations tab&apos;s CAD and USD per player for every season:
            accrued revenue (invoice totals less tax) over the athletes it came from, leaving out team fees and the
            players they paid for, Canadian locations in CAD and US ones in USD, never converted. It starts at Spring
            &apos;25, the first season with invoices.
          </>
        )}
        {feed.played_rule_until && (
          <>
            {" "}The first seasons, before {feed.played_rule_until}, are counted from the games instead: teams that played
            five or more games (once each, so a team re-created part-way through isn&apos;t counted twice) and the players
            on their rosters, as their schedules weren&apos;t kept week by week and their registrations weren&apos;t all
            brought over.
          </>
        )}
        {hasRetention && (
          <>
            {" "}Captain and athlete retention are the Retention page&apos;s captains and athletes returning, for every
            season: of the captains (or athletes) still registered the season before (the previous term, so Fall for
            Winter; each counted once, at the locations in scope), the share who registered again, in any role at any
            Brodie venue. Final counts those whose registration is still standing; to date, those in by day{" "}
            {day ?? "N"} of the season&apos;s registration and not cancelled by then. A season whose previous term had
            nobody here has no bar. Changes on hover are in points, with the counts under them.
          </>
        )}
      </p>
    </div>
  );
}
