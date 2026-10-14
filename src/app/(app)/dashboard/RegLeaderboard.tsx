import { locParam } from "@/lib/seasons";
import { promoFetch } from "@/lib/promo-feed";
import { BasisToggle } from "./BasisToggle";
import { getLocationDistricts } from "@/lib/districts-locations";

// Registrations > Leaderboard: every location ranked, greatest first, by the
// measure picked: teams, athletes, average players per team, revenue, average
// price per player, and the two retention measures. Read from the same registration-pacing feed as the
// other tabs, at the same day N of registration. Money is never compared
// across currencies (the feed carries no exchange rate), so revenue and price
// rank Canada's locations and the US's separately. By district, each
// district's locations are added together (districts from brodie-districts)
// and the averages and shares worked out from the sums.
const PROMO_APP_URL = process.env.PROMO_APP_URL ?? "https://registration-promo-tracker.vercel.app";

type Season = {
  kind: string;
  captains: number;
  athletes: number;
  revenue_native?: number;
  currency?: string;
  athletes_indiv?: number;
  revenue_indiv_native?: number;
  kept?: { ath_total: number; ath_ever?: number; ath_any_4: number };
  back?: { ath_prev_n: number; ath_prev_here: number };
};
type Loc = { location: string; country?: string; seasons: Season[] };

async function loadLocations(season: string, locationNames: string[] | null, flag?: "retention" | "back"): Promise<Loc[] | null> {
  try {
    const url = new URL("/api/registration-pacing", PROMO_APP_URL);
    url.searchParams.set("season", season);
    url.searchParams.set("breakdown", "location");
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

type RankBy = "teams" | "athletes" | "roster" | "revenue" | "price" | "back" | "kept";
const RANKS: { value: RankBy; label: string }[] = [
  { value: "teams", label: "Teams" },
  { value: "athletes", label: "Athletes" },
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
  athletes: number;
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

const money = (n: number, cur: string) => `$${Math.round(n).toLocaleString("en-US")} ${cur}`;

export default async function RegLeaderboard({ season, locationNames, rankBy, groupBy }: {
  season: string; locationNames: string[] | null; rankBy?: string; groupBy?: string;
}) {
  const rank: RankBy = (RANKS.find((r) => r.value === rankBy)?.value) ?? "teams";
  const byDistrict = groupBy === "district";
  const [base, kept, back, districtMap] = await Promise.all([
    loadLocations(season, locationNames),
    loadLocations(season, locationNames, "retention"),
    loadLocations(season, locationNames, "back"),
    byDistrict ? getLocationDistricts() : Promise.resolve(null),
  ]);

  const toggle = (
    <div className="space-y-2">
      <BasisToggle param="group" value={byDistrict ? "district" : "location"}
        options={[{ value: "location", label: "By location" }, { value: "district", label: "By district" }]} />
      <BasisToggle param="rank" value={rank} options={RANKS} />
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
  const locationRows: Row[] = base.map((l) => {
    const c = current(l);
    const indiv = c?.athletes_indiv != null;
    const players = indiv ? c!.athletes_indiv! : (c?.athletes ?? 0);
    const rev = (indiv ? c?.revenue_indiv_native : c?.revenue_native) ?? 0;
    const k = current(keptBy.get(l.location))?.kept;
    const b = current(backBy.get(l.location))?.back;
    return {
      location: l.location,
      currency: (c?.currency ?? (l.country === "USA" ? "USD" : "CAD")).toUpperCase(),
      teams: c?.captains ?? 0,
      athletes: c?.athletes ?? 0,
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
  }).filter((r) => r.teams > 0 || r.athletes > 0 || r.back);

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
  const districtRows = (): Row[] => {
    const groups = new Map<string, Row[]>();
    for (const d of districtMap?.districts ?? []) groups.set(d, []);
    for (const r of locationRows) {
      const d = districtOf(r.location) ?? "No district";
      groups.set(d, [...(groups.get(d) ?? []), r]);
    }
    return [...groups.entries()]
      .filter(([d, rs]) => d !== "No district" || rs.length)
      .map(([d, rs]) => {
        const teams = rs.reduce((a, r) => a + r.teams, 0), athletes = rs.reduce((a, r) => a + r.athletes, 0);
        const priceRev = rs.reduce((a, r) => a + r.priceRev, 0), pricePlayers = rs.reduce((a, r) => a + r.pricePlayers, 0);
        return {
          location: d,
          members: rs.map((r) => r.location).sort((a, b) => a.localeCompare(b)),
          currency: rs[0]?.currency ?? "",
          teams, athletes,
          roster: teams ? athletes / teams : null,
          revenue: rs.reduce((a, r) => a + r.revenue, 0),
          price: pricePlayers ? priceRev / pricePlayers : null,
          back: sumShare(rs.map((r) => r.back)),
          kept: sumShare(rs.map((r) => r.kept)),
          priceRev, pricePlayers,
        };
      });
  };
  const rows: Row[] = byDistrict && districtMap ? districtRows() : locationRows;

  const value = (r: Row): number => {
    switch (rank) {
      case "teams": return r.teams;
      case "athletes": return r.athletes;
      case "roster": return r.roster ?? -1;
      case "revenue": return r.revenue;
      case "price": return r.price ?? -1;
      case "back": return r.back?.pct ?? -1;
      case "kept": return r.kept?.pct ?? -1;
    }
  };
  // Ties go to the bigger base, then the name.
  const tiebreak = (r: Row) => (rank === "back" ? r.back?.of ?? 0 : rank === "kept" ? r.kept?.of ?? 0 : rank === "roster" ? r.teams : r.athletes);
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
  const cell = (k: RankBy, children: React.ReactNode, sub?: string) => (
    <td className="px-4 py-2.5 text-right tabular whitespace-nowrap align-top"
      style={{ color: active(k) ? "var(--glass-text)" : "var(--glass-text-secondary)", fontWeight: active(k) ? 700 : 500 }}>
      <div>{children}</div>
      {sub && <div className="text-[11px] font-normal text-glass-text-tertiary">{sub}</div>}
    </td>
  );

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
              <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: 1080 }}>
                <thead>
                  <tr className="text-xs font-bold text-glass-text-tertiary">
                    {head(null, "#")}
                    {head(null, byDistrict && districtMap ? "District" : "Location", "left")}
                    {head("teams", "Teams")}
                    {head("athletes", "Athletes")}
                    {head("roster", "Avg players per team")}
                    {head("revenue", "Revenue")}
                    {head("price", "Avg price per player")}
                    {head("back", "Retention: past players")}
                    {head("kept", "Retention: registered")}
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r, i) => (
                    <tr key={r.location} style={{ borderTop: "1px solid var(--glass-border)" }}>
                      <td className="px-4 py-2.5 text-right tabular align-top w-10"
                        style={{ color: i < 3 ? "var(--glass-text)" : "var(--glass-text-tertiary)", fontWeight: i < 3 ? 700 : 500 }}>
                        {i + 1}
                      </td>
                      <td className="px-4 py-2.5 align-top">
                        <div className="font-semibold" style={{ color: "var(--glass-text)" }}>{r.location}</div>
                        {r.members && (
                          <div className="text-[11px] text-glass-text-tertiary leading-snug max-w-[260px]">
                            {r.members.length ? r.members.join(", ") : "no registrations in scope"}
                          </div>
                        )}
                      </td>
                      {cell("teams", r.teams.toLocaleString())}
                      {cell("athletes", r.athletes.toLocaleString())}
                      {cell("roster", r.roster == null ? "—" : r.roster.toFixed(1))}
                      {cell("revenue", money(r.revenue, r.currency))}
                      {cell("price", r.price == null ? "—" : money(r.price, r.currency))}
                      {cell("back", r.back ? `${r.back.pct}%` : "—", r.back ? `${r.back.n} of ${r.back.of}` : undefined)}
                      {cell("kept", r.kept ? `${r.kept.pct}%` : "—", r.kept ? `${r.kept.n} of ${r.kept.of}` : undefined)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ))}
      <p className="text-xs text-glass-text-tertiary max-w-[90ch]">
        {season} at the same day of registration as the other tabs. Teams and athletes are registrations that went
        through; average players per team is athletes over teams. Revenue is each location&apos;s own currency; average price per player is what athletes paid for
        themselves over how many did, team fees left out, as on the Registrations tab. Revenue and price rank Canada
        and the US separately, since the two currencies are never mixed. Retention: past players is the share of last
        season&apos;s athletes at the location who registered there again; retention: registered is the share of this
        season&apos;s athletes there who had played Brodie before. Ties go to the location with the bigger base. By
        district adds each district&apos;s locations together, using the districts site&apos;s assignments, and works
        the averages and shares out from the totals.
      </p>
    </div>
  );
}
