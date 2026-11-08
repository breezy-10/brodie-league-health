import { locParam } from "@/lib/seasons";
import { promoFetch } from "@/lib/promo-feed";
import { BasisToggle } from "./BasisToggle";
import { getLocationDistricts } from "@/lib/districts-locations";
import { LeaderboardRow } from "./LeaderboardRow";
import { STICKY_TH_STYLE } from "./stickyTable";

// Registrations > Leaderboard: every location ranked, greatest first, by the
// measure picked: teams, athletes, how sold out each is against its goal
// (teams with 7+ players against the team goal too), average players per
// team, revenue, average price per player, and the two retention measures.
// Read from the same registration-pacing feed as the other tabs, at the same
// day N of registration. Money is never compared
// across currencies (the feed carries no exchange rate), so revenue and price
// rank Canada's locations and the US's separately. By district, each
// district's locations are added together (districts from brodie-districts)
// and the averages and shares worked out from the sums. By location, a venue
// that plays more than one night opens into a row per night (the feed's
// location_day breakdown; retention: past players is a venue figure, so nights
// show a dash there).
const PROMO_APP_URL = process.env.PROMO_APP_URL ?? "https://registration-promo-tracker.vercel.app";

type Season = {
  kind: string;
  captains: number;
  athletes: number;
  // Teams with 7 or more players.
  full_roster?: number;
  revenue_native?: number;
  currency?: string;
  athletes_indiv?: number;
  revenue_indiv_native?: number;
  kept?: { ath_total: number; ath_ever?: number; ath_any_4: number };
  back?: { ath_prev_n: number; ath_prev_here: number };
  // Goals from the admin Goals tab (null = none set; absent = couldn't be read).
  team_goal?: number | null;
  athlete_goal?: number | null;
};
type Loc = { location: string; day?: string; country?: string; seasons: Season[] };

async function loadLocations(
  season: string, locationNames: string[] | null, flag?: "retention" | "back", breakdown: "location" | "location_day" = "location",
): Promise<Loc[] | null> {
  try {
    const url = new URL("/api/registration-pacing", PROMO_APP_URL);
    url.searchParams.set("season", season);
    url.searchParams.set("breakdown", breakdown);
    if (flag) url.searchParams.set(flag, "1");
    const lp = locParam(locationNames);
    if (lp) url.searchParams.set("location", lp);
    const res = await promoFetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as { locations?: Loc[] };
    return Array.isArray(k.locations) ? k.locations : null;
  } catch {
    return null;
  }
}

type RankBy = "teams" | "athletes" | "soldTeams" | "soldFull" | "soldAthletes" | "roster" | "revenue" | "price" | "back" | "kept";
const RANKS: { value: RankBy; label: string }[] = [
  { value: "teams", label: "Teams" },
  { value: "soldTeams", label: "% sold out: teams" },
  { value: "soldFull", label: "% sold out: teams with 7+ players" },
  { value: "athletes", label: "Athletes" },
  { value: "soldAthletes", label: "% sold out: athletes" },
  { value: "roster", label: "Avg players per team" },
  { value: "revenue", label: "Revenue" },
  { value: "price", label: "Avg price per player" },
  { value: "back", label: "Retention: past players" },
  { value: "kept", label: "Retention: registered" },
];

type Share = { n: number; of: number; pct: number } | null;
type Row = {
  location: string;
  // By district: the locations it adds up.
  members?: string[];
  currency: string;
  teams: number;
  // Teams with 7 or more players; null where the feed didn't send it.
  full: number | null;
  athletes: number;
  teamGoal: number | null;
  athleteGoal: number | null;
  soldTeams: number | null;
  soldFull: number | null;
  soldAthletes: number | null;
  roster: number | null;
  revenue: number;
  price: number | null;
  back: Share;
  kept: Share;
  // The parts the averages come from, so a district can sum them.
  priceRev: number;
  pricePlayers: number;
};
const share = (n: number | undefined, of: number | undefined): Share =>
  n != null && of ? { n, of, pct: Math.round((1000 * n) / of) / 10 } : null;
// Registered against the goal, one decimal; null with no goal set.
const soldPct = (n: number, goal: number | null): number | null =>
  goal ? Math.round((1000 * n) / goal) / 10 : null;

const money = (n: number, cur: string) => `$${Math.round(n).toLocaleString("en-US")} ${cur}`;

export default async function RegLeaderboard({ season, locationNames, rankBy, groupBy }: {
  season: string; locationNames: string[] | null; rankBy?: string; groupBy?: string;
}) {
  const rank: RankBy = (RANKS.find((r) => r.value === rankBy)?.value) ?? "teams";
  const byDistrict = groupBy === "district";
  const [base, kept, back, districtMap, nights, nightsKept] = await Promise.all([
    loadLocations(season, locationNames),
    loadLocations(season, locationNames, "retention"),
    loadLocations(season, locationNames, "back"),
    byDistrict ? getLocationDistricts() : Promise.resolve(null),
    byDistrict ? Promise.resolve(null) : loadLocations(season, locationNames, undefined, "location_day"),
    byDistrict ? Promise.resolve(null) : loadLocations(season, locationNames, "retention", "location_day"),
  ]);

  const toggle = (
    // Two rows: what to rank (locations or districts), then by what.
    <div className="space-y-2">
      <div>
        <BasisToggle param="group" value={byDistrict ? "district" : "location"}
          options={[{ value: "location", label: "By location" }, { value: "district", label: "By district" }]} />
      </div>
      <div>
        <BasisToggle param="rank" value={rank} options={RANKS} />
      </div>
    </div>
  );
  if (!base) {
    return (
      <div className="space-y-4">
        {toggle}
        <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm text-glass-text-tertiary shadow-card">
          <span className="font-semibold" style={{ color: "var(--glass-text-secondary)" }}>Not connected.</span>{" "}
          League Health couldn&apos;t load registrations from the Promo Tracker, so no leaderboard is shown.
        </div>
      </div>
    );
  }

  const current = (l?: Loc) => l?.seasons.find((s) => s.kind === "current");
  const byName = (list: Loc[] | null) => new Map((list ?? []).map((l) => [l.location, l]));
  const keptBy = byName(kept), backBy = byName(back);
  const toRow = (l: Loc, keptLoc?: Loc, backLoc?: Loc): Row => {
    const c = current(l);
    const indiv = c?.athletes_indiv != null;
    const players = indiv ? c!.athletes_indiv! : (c?.athletes ?? 0);
    const rev = (indiv ? c?.revenue_indiv_native : c?.revenue_native) ?? 0;
    const k = current(keptLoc)?.kept;
    const b = current(backLoc)?.back;
    const teamGoal = c?.team_goal ?? null, athleteGoal = c?.athlete_goal ?? null;
    return {
      location: l.location,
      currency: (c?.currency ?? (l.country === "USA" ? "USD" : "CAD")).toUpperCase(),
      teams: c?.captains ?? 0,
      full: c?.full_roster ?? null,
      athletes: c?.athletes ?? 0,
      teamGoal, athleteGoal,
      soldTeams: soldPct(c?.captains ?? 0, teamGoal),
      soldFull: c?.full_roster != null ? soldPct(c.full_roster, teamGoal) : null,
      soldAthletes: soldPct(c?.athletes ?? 0, athleteGoal),
      roster: c?.captains ? (c.athletes ?? 0) / c.captains : null,
      revenue: c?.revenue_native ?? 0,
      price: players ? rev / players : null,
      // Of last season's athletes here, how many registered here again.
      back: share(b?.ath_prev_here, b?.ath_prev_n),
      // Of this season's athletes here, how many had played Brodie before.
      kept: share(k?.ath_ever ?? k?.ath_any_4, k?.ath_total),
      priceRev: rev,
      pricePlayers: players,
    };
  };
  const locationRows: Row[] = base.map((l) => toRow(l, keptBy.get(l.location), backBy.get(l.location)))
    .filter((r) => r.teams > 0 || r.athletes > 0 || r.back);

  // Each venue's nights, in week order as the feed sends them; venues with two
  // or more get a dropdown, and a venue with one names its night.
  const nightKey = (l: Loc) => `${l.location}|${l.day ?? ""}`;
  const nightKeptBy = new Map((nightsKept ?? []).map((l) => [nightKey(l), l]));
  const nightsBy = new Map<string, { day: string; row: Row }[]>();
  for (const l of nights ?? []) {
    if (!l.day) continue;
    const list = nightsBy.get(l.location) ?? [];
    list.push({ day: l.day, row: toRow(l, nightKeptBy.get(nightKey(l))) });
    nightsBy.set(l.location, list);
  }

  // By district: every district from brodie-districts, its locations summed.
  // A location the feed names a little differently ("Seattle (Capitol Hill)")
  // is matched without its bracket when every match is in one district.
  const districtOf = (name: string): string | null => {
    if (!districtMap) return null;
    const exact = districtMap.byLocation.get(name);
    if (exact) return exact;
    const norm = (x: string) => x.toLowerCase().replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
    // Every location it could be sits in one district: that's the one.
    const ds = new Set([...districtMap.byLocation.entries()].filter(([n]) => norm(n) === norm(name)).map(([, d]) => d));
    return ds.size === 1 ? [...ds][0] : null;
  };
  const sumShare = (list: Share[]): Share => {
    const n = list.reduce((a, x) => a + (x?.n ?? 0), 0), of = list.reduce((a, x) => a + (x?.of ?? 0), 0);
    return share(n, of);
  };
  // Rows added together: counts and goals summed (no goal set anywhere = no
  // goal), the averages and shares worked out from the sums. Revenue and price
  // only mean something within one currency; the total row splits them.
  const rollUp = (name: string, rs: Row[]): Row => {
    const teams = rs.reduce((a, r) => a + r.teams, 0), athletes = rs.reduce((a, r) => a + r.athletes, 0);
    const priceRev = rs.reduce((a, r) => a + r.priceRev, 0), pricePlayers = rs.reduce((a, r) => a + r.pricePlayers, 0);
    const sumGoal = (pick: (r: Row) => number | null) =>
      rs.some((r) => pick(r) != null) ? rs.reduce((a, r) => a + (pick(r) ?? 0), 0) : null;
    const teamGoal = sumGoal((r) => r.teamGoal), athleteGoal = sumGoal((r) => r.athleteGoal);
    const full = sumGoal((r) => r.full);
    return {
      location: name,
      currency: rs[0]?.currency ?? "",
      teams, full, athletes,
      teamGoal, athleteGoal,
      soldTeams: soldPct(teams, teamGoal),
      soldFull: full != null ? soldPct(full, teamGoal) : null,
      soldAthletes: soldPct(athletes, athleteGoal),
      roster: teams ? athletes / teams : null,
      revenue: rs.reduce((a, r) => a + r.revenue, 0),
      price: pricePlayers ? priceRev / pricePlayers : null,
      back: sumShare(rs.map((r) => r.back)),
      kept: sumShare(rs.map((r) => r.kept)),
      priceRev, pricePlayers,
    };
  };
  const districtRows = (): Row[] => {
    const groups = new Map<string, Row[]>();
    for (const d of districtMap?.districts ?? []) groups.set(d, []);
    for (const r of locationRows) {
      const d = districtOf(r.location) ?? "No district";
      groups.set(d, [...(groups.get(d) ?? []), r]);
    }
    return [...groups.entries()]
      .filter(([d, rs]) => d !== "No district" || rs.length)
      .map(([d, rs]) => ({ ...rollUp(d, rs), members: rs.map((r) => r.location).sort((a, b) => a.localeCompare(b)) }));
  };
  const rows: Row[] = byDistrict && districtMap ? districtRows() : locationRows;

  const value = (r: Row): number => {
    switch (rank) {
      case "teams": return r.teams;
      case "athletes": return r.athletes;
      case "soldTeams": return r.soldTeams ?? -1;
      case "soldFull": return r.soldFull ?? -1;
      case "soldAthletes": return r.soldAthletes ?? -1;
      case "roster": return r.roster ?? -1;
      case "revenue": return r.revenue;
      case "price": return r.price ?? -1;
      case "back": return r.back?.pct ?? -1;
      case "kept": return r.kept?.pct ?? -1;
    }
  };
  // Ties go to the bigger base, then the name.
  const tiebreak = (r: Row) => (rank === "back" ? r.back?.of ?? 0 : rank === "kept" ? r.kept?.of ?? 0 : rank === "roster" ? r.teams
    : rank === "soldTeams" || rank === "soldFull" ? r.teamGoal ?? 0 : rank === "soldAthletes" ? r.athleteGoal ?? 0 : r.athletes);
  const sorted = (list: Row[]) => [...list].sort((a, b) =>
    value(b) - value(a) || tiebreak(b) - tiebreak(a) || a.location.localeCompare(b.location));

  const isMoney = rank === "revenue" || rank === "price";
  const groups: { title: string | null; rows: Row[] }[] = isMoney
    ? ["CAD", "USD"].map((cur) => ({
        title: cur === "CAD" ? "Canada · CAD" : "United States · USD",
        rows: sorted(rows.filter((r) => r.currency === cur)),
      })).filter((g) => g.rows.length)
    : [{ title: null, rows: sorted(rows) }];

  const active = (k: RankBy) => k === rank;
  const head = (k: RankBy | null, label: string, align: "left" | "right" = "right") => (
    <th className={`px-4 py-2.5 font-bold ${align === "left" ? "text-left" : "text-right"}`}
      style={k && active(k) ? { color: "var(--glass-text)" } : undefined}>
      {label}
    </th>
  );
  const ofGoal = (n: number, goal: number | null) => (goal ? `${n.toLocaleString()} / ${goal.toLocaleString()}` : n.toLocaleString());
  const left = (n: number, goal: number | null, unit: string) => {
    if (goal == null) return undefined;
    if (n >= goal) return "Sold out";
    const gap = goal - n;
    return `${gap.toLocaleString()} ${gap === 1 ? unit : `${unit}s`} to go`;
  };
  // The total row's cells are all strong, the ranked column's as on any row.
  const cell = (k: RankBy | null, children: React.ReactNode, sub?: string, strong = false) => (
    <td className="px-4 py-2.5 text-right tabular whitespace-nowrap align-top"
      style={{ color: strong || (k && active(k)) ? "var(--glass-text)" : "var(--glass-text-secondary)", fontWeight: k && active(k) ? 700 : strong ? 600 : 500 }}>
      <div>{children}</div>
      {sub && <div className="text-[11px] font-normal text-glass-text-tertiary">{sub}</div>}
    </td>
  );
  // byCurrency (the total row): the same rows rolled up per currency, so
  // revenue and price show a line for each instead of adding CAD to USD.
  const cells = (r: Row, byCurrency?: Row[]) => {
    const strong = !!byCurrency;
    const perCurrency = (f: (x: Row) => string) =>
      byCurrency && byCurrency.length > 1 ? byCurrency.map((x) => <div key={x.currency}>{f(x)}</div>) : f(r);
    return (
      <>
        {cell("teams", ofGoal(r.teams, r.teamGoal), undefined, strong)}
        {cell("soldTeams", r.soldTeams == null ? "—" : `${r.soldTeams}%`, left(r.teams, r.teamGoal, "team"), strong)}
        {cell(null, r.full == null ? "—" : `${r.full.toLocaleString()} / ${r.teams.toLocaleString()}`,
          r.full != null && r.teams ? `${Math.round((1000 * r.full) / r.teams) / 10}% of teams` : undefined, strong)}
        {cell("soldFull", r.soldFull == null ? "—" : `${r.soldFull}%`, r.full == null ? undefined : left(r.full, r.teamGoal, "team"), strong)}
        {cell("athletes", ofGoal(r.athletes, r.athleteGoal), undefined, strong)}
        {cell("soldAthletes", r.soldAthletes == null ? "—" : `${r.soldAthletes}%`, left(r.athletes, r.athleteGoal, "athlete"), strong)}
        {cell("roster", r.roster == null ? "—" : r.roster.toFixed(1), undefined, strong)}
        {cell("revenue", perCurrency((x) => money(x.revenue, x.currency)), undefined, strong)}
        {cell("price", perCurrency((x) => (x.price == null ? "—" : money(x.price, x.currency))), undefined, strong)}
        {cell("back", r.back ? `${r.back.pct}%` : "—", r.back ? `${r.back.n.toLocaleString()} of ${r.back.of.toLocaleString()}` : undefined, strong)}
        {cell("kept", r.kept ? `${r.kept.pct}%` : "—", r.kept ? `${r.kept.n.toLocaleString()} of ${r.kept.of.toLocaleString()}` : undefined, strong)}
      </>
    );
  };
  // Every row of a group added together, under it.
  const totalRow = (list: Row[]) => {
    const total = rollUp("Total", list);
    const currencies = [...new Set(list.map((r) => r.currency))].sort();
    const byCurrency = currencies.map((cur) => rollUp(cur, list.filter((r) => r.currency === cur)));
    const unit = byDistrict && districtMap ? "district" : "location";
    return (
      <tr style={{ borderTop: "1px solid var(--glass-border)", background: STICKY_TH_STYLE.background }}>
        <td />
        <td className="px-4 py-2.5 align-top">
          <div className="font-semibold" style={{ color: "var(--glass-text)" }}>Total</div>
          <div className="text-[11px] text-glass-text-tertiary">{list.length} {list.length === 1 ? unit : `${unit}s`}</div>
        </td>
        {cells(total, byCurrency)}
      </tr>
    );
  };
  const nightRows = (list: { day: string; row: Row }[]) => list.map(({ day, row }) => (
    <tr key={day} style={{ borderTop: "1px solid var(--glass-border)", background: "var(--glass-surface-hover)" }}>
      <td />
      <td className="px-4 py-2 align-top pl-9 text-[13px]" style={{ color: "var(--glass-text-secondary)" }}>{day}</td>
      {cells(row)}
    </tr>
  ));

  return (
    <div className="space-y-4">
      {toggle}
      {byDistrict && !districtMap && (
        <p className="text-sm text-glass-text-tertiary">
          Couldn&apos;t load districts from the districts site, so this shows locations.
        </p>
      )}
      {groups.length === 0 || rows.length === 0 ? (
        <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary shadow-card">
          No registrations for {season} in this scope yet.
        </div>
      ) : groups.map((g) => (
        <div key={g.title ?? "all"} className="space-y-2">
          {g.title && <h3 className="text-sm font-semibold" style={{ color: "var(--glass-text)" }}>{g.title}</h3>}
          <div className="rounded-2xl bg-glass-surface overflow-hidden shadow-card">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: 1600 }}>
                <thead>
                  <tr className="text-xs font-bold text-glass-text-tertiary">
                    {head(null, "#")}
                    {head(null, byDistrict && districtMap ? "District" : "Location", "left")}
                    {head("teams", "Teams")}
                    {head("soldTeams", "% sold out: teams")}
                    {head(null, "Teams with 7+ players")}
                    {head("soldFull", "% sold out: teams with 7+ players")}
                    {head("athletes", "Athletes")}
                    {head("soldAthletes", "% sold out: athletes")}
                    {head("roster", "Avg players per team")}
                    {head("revenue", "Revenue")}
                    {head("price", "Avg price per player")}
                    {head("back", "Retention: past players")}
                    {head("kept", "Retention: registered")}
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r, i) => {
                    const ns = !r.members ? nightsBy.get(r.location) : undefined;
                    return (
                      <LeaderboardRow
                        key={r.location}
                        rank={i + 1}
                        name={r.location}
                        sub={r.members ? (
                          <div className="text-[11px] text-glass-text-tertiary leading-snug max-w-[260px]">
                            {r.members.length ? r.members.join(", ") : "no registrations in scope"}
                          </div>
                        ) : undefined}
                        cells={cells(r)}
                        nights={ns && ns.length > 1 ? nightRows(ns) : undefined}
                        nightCount={ns?.length}
                        onlyNight={ns?.length === 1 ? ns[0].day : undefined}
                      />
                    );
                  })}
                </tbody>
                <tfoot>{totalRow(g.rows)}</tfoot>
              </table>
            </div>
          </div>
        </div>
      ))}
      <p className="text-xs text-glass-text-tertiary max-w-[90ch]">
        {season} at the same day of registration as the other tabs. Teams and athletes are registrations that went
        through, shown against the location&apos;s goal for the season (teams / goal) where the admin Goals tab has one;
        % sold out is teams or athletes over that goal, and a location with no goal set shows a dash. Teams with 7+
        players counts teams with 7 or more players on the roster, shown over the location&apos;s teams; % sold out:
        teams with 7+ players is that count over the team goal. A location that
        plays more than one day opens (the arrow) into a row per day with that day&apos;s goal, and a location that
        plays one day names it; retention: past players is worked out for the whole location, so a day shows a dash
        there. Average players per team is
        athletes over teams. Revenue is each location&apos;s own currency; average price per player is what athletes paid for
        themselves over how many did, team fees left out, as on the Registrations tab. Revenue and price rank Canada
        and the US separately, since the two currencies are never mixed. Retention: past players is the share of last
        season&apos;s athletes at the location who registered there again; retention: registered is the share of this
        season&apos;s athletes there who had played Brodie before. Ties go to the location with the bigger base. By
        district adds each district&apos;s locations together, using the districts site&apos;s assignments, and works
        the averages and shares out from the totals. The total row adds up every row above it the same way, with
        revenue and price per player shown for each currency.
      </p>
    </div>
  );
}
