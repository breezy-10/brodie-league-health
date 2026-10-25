import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canonicalLocation, csvParam, locParam, resolveScope } from "@/lib/seasons";
import Filters, { type FilterOptions } from "../../dashboard/Filters";
import { discountTone, freeTone } from "../rates";
import DiscountTable, { type ScopeTeamData } from "./DiscountTable";
import DiscountLeaderboard, { type LeaderRow, type LeaderSort } from "./DiscountLeaderboard";
import { BasisToggle } from "../../dashboard/BasisToggle";
import { loadStaff } from "@/lib/staff";
import { loadAmbassadorTeams } from "../../ambassador-teams/AmbassadorSummary";
import { promoFetch } from "@/lib/promo-feed";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PROMO_APP_URL = process.env.PROMO_APP_URL ?? "https://registration-promo-tracker.vercel.app";

const BACK_BTN =
  "inline-flex items-center gap-1.5 rounded-full bg-[color:var(--fill-3)] px-3.5 py-2 text-sm font-semibold text-glass-text hover:bg-glass-surface-hover hover:border-glass-gold transition";

const GOLD = "var(--glass-gold)";

type DiscountPlayer = {
  player: string; location: string; currency: string; type: string; team: string | null;
  list_price: number; discount: number; total_paid: number; free: boolean;
  codes: string; discount_names?: string; registered_on: string | null;
  season_team_id?: string | null; player_id?: string | null;
  // Everyone on that team's roster (absent from an older feed).
  team_players?: number;
  // What each group of the registration's codes took off (absent from an
  // older feed): a returning-player $20 stacked with an ambassador $30 is 20
  // returning and 30 other.
  returning_amount?: number; referral_amount?: number; other_amount?: number;
};
// unrostered: every free agent not yet on a team, discounted or not (asked
// for in team view only).
// teams: every registered team in scope, discounted or not (team view only).
type Feed = { season: string; players: DiscountPlayer[]; truncated: boolean; unrostered?: DiscountPlayer[]; teams?: ScopeTeamData[] };
type TotalsFeed = { locations: (LeaderRow & { currency: string; regs: number })[] };

// Every location in scope with its discounts, from the Discounts tab's feed:
// the leaderboard's rows, and the total registrations the players feed can't
// supply (it only returns rows that carried a discount).
async function loadLocations(season: string, locationNames: string[] | null): Promise<TotalsFeed["locations"] | null> {
  try {
    const url = new URL("/api/discounts", PROMO_APP_URL);
    url.searchParams.set("season", season);
    const lp = locParam(locationNames);
    if (lp) url.searchParams.set("location", lp);
    const res = await promoFetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as TotalsFeed;
    return k.locations ?? [];
  } catch {
    return null;
  }
}

// Teams registered in scope, from the Promo Tracker's KPI feed: registered,
// active and not deleted in the ops DB, the dashboard's Total teams basis.
async function loadTeamCount(season: string, locationNames: string[] | null): Promise<number | null> {
  try {
    const url = new URL("/api/dashboard-kpis", PROMO_APP_URL);
    url.searchParams.set("season", season);
    const lp = locParam(locationNames);
    if (lp) url.searchParams.set("location", lp);
    const res = await promoFetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as { teams_registered?: number };
    return typeof k.teams_registered === "number" ? k.teams_registered : null;
  } catch {
    return null;
  }
}

async function loadPlayers(season: string, locationNames: string[] | null, freeOnly: boolean, unrostered = false): Promise<Feed | null> {
  try {
    const url = new URL("/api/discounts/players", PROMO_APP_URL);
    url.searchParams.set("season", season);
    if (freeOnly) url.searchParams.set("free", "1");
    if (unrostered) url.searchParams.set("unrostered", "1");
    // Team view also lists the teams with no discount, so it asks for them all.
    if (unrostered) url.searchParams.set("teams", "1");
    const lp = locParam(locationNames);
    if (lp) url.searchParams.set("location", lp);
    const res = await promoFetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as Feed;
    return k.players ? k : null;
  } catch {
    return null;
  }
}

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function DiscountPlayersPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; location?: string; free?: string; kind?: string; view?: string; currency?: string; sort?: string; player?: string; name?: string }>;
}) {
  await requireUser();
  const { season: seasonParam, location: locationParam, free: freeParam, kind: kindParam, view: viewParam, currency: currencyParam, sort: sortParam, player: playerParam, name: nameParam } = await searchParams;
  // The Discounts tab's cards are per currency (Canada, United States), so
  // their links carry it and this list narrows to match the card's count.
  // The leaderboard always compares both countries, so it ignores a currency
  // left in the URL (a card link, a bookmark) rather than hiding Canada.
  // A currency only narrows the all-locations list (a Discounts tab country
  // card links here with one). Each location has a single currency, so with
  // a location picked it's redundant or, left over from that card, empties the
  // page (USD with Burlington). The leaderboard always shows both countries.
  const currency = viewParam !== "leaderboard" && csvParam(locationParam).length === 0
    && (currencyParam === "CAD" || currencyParam === "USD") ? currencyParam : null;
  const COUNTRY = { CAD: "Canada", USD: "United States" } as const;
  // Team view (the default) shows the teams; player view lists each
  // registration; the leaderboard ranks locations by discount, by volume or
  // by share of list price. "teams" in an older link still means team view.
  const leaderboardView = viewParam === "leaderboard";
  const playerView = viewParam === "players";
  const teamView = !leaderboardView && !playerView;
  // A player's name in a team roster opens player view narrowed to them.
  const playerFilter = playerView && playerParam ? playerParam : null;
  // The leaderboard ranks by share of list price unless asked for volume.
  const sort: LeaderSort = sortParam === "volume" ? "volume" : "share";
  const freeOnly = freeParam === "1";
  // kind narrows the list to one group, matching a tile on the Discounts tab:
  // "referral" and "returning" are the two flat programmes, "other" is every
  // discount that was neither.
  const kind = kindParam === "other" || kindParam === "referral" || kindParam === "returning" ? kindParam : null;
  const KIND_TITLE = { other: "Other discounts", referral: "Referral discounts", returning: "Returning player discounts" } as const;
  const KIND_LEDE = {
    other: "Every discounted registration that wasn\u2019t the returning-player discount or a referral.",
    referral: "Every registration discounted through the referral program.",
    returning: "Every registration that got the returning-player discount.",
  } as const;
  const KIND_SCOPE = {
    other: "carried a discount other than the returning-player discount or a referral",
    referral: "carried a referral discount",
    returning: "carried the returning-player discount",
  } as const;
  const selectedSeasons = csvParam(seasonParam);
  const selectedLocations = csvParam(locationParam).map(canonicalLocation);
  const { filterLocations, promoSeasons, selectedSeason, locationNames } = await resolveScope(
    { season: selectedSeasons[0], locations: selectedLocations },
    { defaultSeason: "registration" },
  );
  const [feed, locationRows, staff, teamCount, ambassadorFeed] = await Promise.all([
    loadPlayers(selectedSeason, locationNames, freeOnly, teamView),
    loadLocations(selectedSeason, locationNames),
    loadStaff(),
    loadTeamCount(selectedSeason, locationNames),
    // Every location, so an ambassador registered somewhere else in scope is
    // still tagged.
    loadAmbassadorTeams(selectedSeason, null),
  ]);
  // The season's ambassadors (captains of an ambassador team), by ops player
  // id, which is what each discounted registration carries.
  const leaderRows = (locationRows ?? []).filter((r) => !currency || r.currency === currency);
  const totalRegs = locationRows === null ? null : leaderRows.reduce((n, r) => n + (r.regs ?? 0), 0);
  const ambassadors = ambassadorFeed
    ? [...new Set([
        ...Object.keys(ambassadorFeed.captains ?? {}),
        ...ambassadorFeed.locations.flatMap((l) => l.rows.map((r) => r.captain_id)).filter((id): id is string => !!id),
      ])]
    : null;
  // Which groups a row belongs to: by what each group of its codes took off
  // when the feed says, so a returning-player code stacked with an ambassador
  // code counts under both, each for its own part. An older feed falls back to
  // the code names, returning player winning a tie.
  const hasAmounts = (r: DiscountPlayer) => r.returning_amount != null && r.other_amount != null;
  const isReturning = (r: DiscountPlayer) =>
    hasAmounts(r) ? (r.returning_amount ?? 0) > 0 : /returning player/i.test(r.discount_names ?? "");
  const isReferral = (r: DiscountPlayer) =>
    hasAmounts(r) ? (r.referral_amount ?? 0) > 0 : !/returning player/i.test(r.discount_names ?? "") && /referral/i.test(r.discount_names ?? "");
  const isOther = (r: DiscountPlayer) =>
    hasAmounts(r) ? (r.other_amount ?? 0) > 0.009 : !isReturning(r) && !isReferral(r);
  // What a row gave up toward one group: that group's own part, or the whole
  // discount when no group is picked.
  const partOf = (r: DiscountPlayer, k: "returning" | "referral" | "other" | null) =>
    !k || !hasAmounts(r) ? r.discount
      : k === "returning" ? r.returning_amount ?? 0 : k === "referral" ? r.referral_amount ?? 0 : r.other_amount ?? 0;
  const inKind = (r: DiscountPlayer) =>
    kind === "returning" ? isReturning(r) : kind === "referral" ? isReferral(r) : isOther(r);
  const inCurrency = (r: DiscountPlayer) => !currency || r.currency === currency;
  const allRows = (feed?.players ?? []).filter(inCurrency);
  const rows = kind ? allRows.filter(inKind) : allRows;
  // Team view's last block: free agents not on a team yet, whatever they paid
  // — narrowed like the list when it is free-only or other-only — plus any
  // discounted registration without a team that isn't a free agent.
  const unrosteredRows = (() => {
    if (!teamView) return [];
    const fa = (feed?.unrostered ?? []).filter(inCurrency).filter((r) =>
      freeOnly ? r.free : kind ? r.discount > 0 && inKind(r) : true);
    const seen = new Set(fa.map((r) => r.player_id));
    return [...fa, ...rows.filter((r) => !r.season_team_id && !seen.has(r.player_id ?? null))];
  })();
  const free = rows.filter((r) => r.free).length;
  const returning = rows.filter(isReturning).length;
  const referral = rows.filter(isReferral).length;
  // Every discount that isn't the returning-player discount, a referral or a
  // free registration (free has its own card).
  const isOtherPaid = (r: DiscountPlayer) => isOther(r) && !r.free;
  const other = rows.filter(isOtherPaid).length;
  // What each programme cost, reported per currency like the Given up card —
  // a CAD figure and a USD figure are never added together.
  const givenUp = (pred: (r: DiscountPlayer) => boolean, k: "returning" | "referral" | "other" | null) => {
    const m = new Map<string, number>();
    for (const r of rows) if (pred(r)) m.set(r.currency, (m.get(r.currency) ?? 0) + partOf(r, k));
    return [...m.entries()].sort().map(([c, v]) => `${money(v)} ${c}`).join(" \u00b7 ");
  };
  // Currencies are never summed; the total is reported once per currency.
  const totalByCurrency = new Map<string, number>();
  for (const r of rows) totalByCurrency.set(r.currency, (totalByCurrency.get(r.currency) ?? 0) + partOf(r, kind));

  // Carry the filters back to the tab that linked here.
  const options: FilterOptions = {
    seasons: promoSeasons.map((s) => ({ value: s, label: s })),
    locations: filterLocations,
  };

  const back = new URLSearchParams();
  if (seasonParam) back.set("season", seasonParam);
  if (locationParam) back.set("location", locationParam);
  const backHref = `/discounts${back.toString() ? `?${back}` : ""}`;

  return (
    <main className="brodie-fade-in space-y-6">
      <div>
        <Link href={backHref} className={BACK_BTN}>← Discounts</Link>
      </div>

      <header>
        <h2 className="page-h2">
          {freeOnly ? "Every free registration" : kind ? KIND_TITLE[kind] : "Every discounted registration"}
        </h2>
        {(kind && !freeOnly) || currency ? (
          <p className="page-lede mt-1">
            {kind && !freeOnly ? KIND_LEDE[kind] : null}
            {currency ? `${kind && !freeOnly ? " " : ""}${COUNTRY[currency]} only, as on the Discounts tab\u2019s card.` : null}
          </p>
        ) : null}
      </header>

      <Filters
        key={`${selectedSeasons.join(",")}|${selectedLocations.join(",")}`}
        options={options}
        current={{
          seasons: selectedSeasons.length ? selectedSeasons : [selectedSeason],
          locations: selectedLocations,
        }}
        // Changing a filter must not quietly widen a free-only list back out,
        // or drop back to team view from the player view or the leaderboard.
        // The currency isn't kept: it belongs to the card link that set it.
        keep={freeOnly || kind || playerView || leaderboardView
          ? { ...(freeOnly ? { free: "1" } : {}), ...(kind ? { kind } : {}), ...(playerView ? { view: "players" } : {}),
              ...(leaderboardView ? { view: "leaderboard", ...(sort === "volume" ? { sort } : {}) } : {}) }
          : undefined}
      />

      <div className="space-y-3">
        <BasisToggle
          param="view"
          value={leaderboardView ? "leaderboard" : teamView ? "teams" : "players"}
          // The leaderboard compares every location in both countries, so it
          // drops a location or currency the page was narrowed to.
          clearOn={{ leaderboard: ["location", "currency"], teams: ["player", "name"] }}
          options={[
            { value: "teams", label: "Team view" },
            { value: "players", label: "Player view" },
            { value: "leaderboard", label: "Leaderboard" },
          ]}
        />
        {leaderboardView && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-semibold text-glass-text-tertiary">Rank by</span>
            <BasisToggle
              param="sort"
              value={sort}
              options={[{ value: "share", label: "% of list price" }, { value: "volume", label: "Discount volume" }]}
            />
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <div className={`grid gap-3 grid-cols-2 ${
          freeOnly ? "md:grid-cols-3" : kind ? "md:grid-cols-4" : "md:grid-cols-4 lg:grid-cols-7"}`}>
          <Tile label="Total registrations" value={totalRegs === null ? "—" : totalRegs.toLocaleString()}
            sub={teamCount === null ? undefined : `${teamCount.toLocaleString()} team${teamCount === 1 ? "" : "s"}`} />
          <Tile label={freeOnly ? "Free registrations" : kind ? KIND_TITLE[kind] : "Discounted registrations"}
            value={rows.length.toLocaleString()} accent={freeOnly ? GOLD : undefined}
            sub={totalRegs ? <Pct n={rows.length} of={totalRegs} tone={freeOnly ? freeTone : discountTone} /> : undefined} />
          {!freeOnly && !kind && (
            <>
              <Tile label="Returning player" value={returning.toLocaleString()}
                sub={<Sub pct={totalRegs ? <Pct n={returning} of={totalRegs} tone={discountTone} /> : null}
                  cost={givenUp(isReturning, "returning")} />} />
              <Tile label="Referral" value={referral.toLocaleString()}
                sub={<Sub pct={totalRegs ? <Pct n={referral} of={totalRegs} tone={discountTone} /> : null}
                  cost={givenUp(isReferral, "referral")} />} />
              <Tile label="Other discounts" value={other.toLocaleString()}
                sub={<Sub pct={totalRegs ? <Pct n={other} of={totalRegs} tone={discountTone} /> : null}
                  cost={givenUp(isOtherPaid, "other")} />} />
            </>
          )}
          {!freeOnly && (
            <Tile label="Free" value={free.toLocaleString()} accent={GOLD}
              sub={<Sub pct={totalRegs ? <Pct n={free} of={totalRegs} tone={freeTone} /> : null}
                cost={givenUp((r) => r.free, null)} />} />
          )}
          {/* Never summed across currencies — each is its own figure. */}
          <Tile label="Given up"
            values={[...totalByCurrency.entries()].sort().map(([c, v]) => `${money(v)} ${c}`)} />
        </div>
      )}

      {leaderboardView ? (
        locationRows === null ? (
          <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary shadow-card">
            Discount feed unavailable — the Promo Tracker didn&apos;t answer for {selectedSeason}.
          </div>
        ) : (
          <DiscountLeaderboard rows={leaderRows} sort={sort} kind={kind} freeOnly={freeOnly}
            linkFor={(loc, cur) => {
              // A location's name opens its own team view, same season and filters.
              const q = new URLSearchParams();
              if (seasonParam) q.set("season", seasonParam);
              q.set("location", loc);
              q.set("currency", cur);
              q.set("view", "teams");
              if (freeOnly) q.set("free", "1");
              if (kind) q.set("kind", kind);
              return `/discounts/players?${q}`;
            }} />
        )
      ) : !feed ? (
        <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary shadow-card">
          Discount feed unavailable — the Promo Tracker didn&apos;t answer for {selectedSeason}.
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary shadow-card">
          No {freeOnly ? "free" : kind ? KIND_TITLE[kind].toLowerCase().replace(" discounts", " discounted") : "discounted"} registrations for {selectedSeason} in this scope.
        </div>
      ) : (
        <>
        {playerFilter && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span style={{ color: "var(--glass-text)" }}>
              Showing <b>{nameParam || "one player"}</b> only
              {rows.some((r) => r.player_id === playerFilter) ? "" : ` · no discounted registration in ${selectedSeason}`}
            </span>
            <Link className="br-link" href={(() => {
              const q = new URLSearchParams();
              if (seasonParam) q.set("season", seasonParam);
              if (locationParam) q.set("location", locationParam);
              if (currency) q.set("currency", currency);
              q.set("view", "players");
              return `/discounts/players?${q}`;
            })()}>Show everyone</Link>
          </div>
        )}
        <DiscountTable key={teamView ? "teams" : "players"} season={selectedSeason} staff={staff} ambassadors={ambassadors} teamView={teamView}
          rows={playerFilter ? rows.filter((r) => r.player_id === playerFilter) : rows}
          unrostered={unrosteredRows}
          // Every team in scope: each team's list price and total come from it,
          // and the teams with no discount are listed only on the full list,
          // not one narrowed to free registrations or one kind of discount.
          scopeTeams={teamView ? (feed.teams ?? []).filter((t) => !currency || t.currency === currency) : undefined}
          listNone={!freeOnly && !kind} />
        </>
      )}

      {leaderboardView ? (
        <p className="text-xs text-glass-text-tertiary max-w-[80ch]">
          Every location in {selectedSeason}, ranked by {sort === "share" ? "discount as a share of its total list price" : "how much it gave up in discounts"}
          {freeOnly ? " on free registrations" : kind ? ` (${KIND_TITLE[kind].toLowerCase()} only)` : ""}, the same registrations the
          Discounts tab counts. Canada and the United States are ranked separately, since dollars in two currencies
          aren&apos;t compared. Avg per player is the list price less every discount, divided by registrations,
          before tax and card fees. A location&apos;s name opens its team view.
        </p>
      ) : (
      <p className="text-xs text-glass-text-tertiary max-w-[80ch]">
        Every registration in {selectedSeason} that {freeOnly
          ? "paid nothing"
          : kind
            ? KIND_SCOPE[kind]
            : "carried a discount"}, largest first — the same scope as the
        Discounts tab, so the count here matches the &ldquo;{freeOnly ? "free" : kind ? KIND_TITLE[kind].toLowerCase() : "discounted"}&rdquo; tile. A code that has since been
        deleted takes its usage records with it, so a registration can carry a discount with nothing left to name it;
        those show as <span className="font-mono">(code removed)</span> rather than being dropped, because the money
        still came off. {teamView && !freeOnly && !kind ? "Team view lists the teams with no discounted registration at the bottom. " : ""}
        {feed?.truncated ? "Only the first 2,000 rows are shown." : ""}
      </p>
      )}
    </main>
  );
}

// A rate with its band colour, for a card's sub-label.
// Share of registrations on one line, what the programme gave up on the next.
function Sub({ pct, cost }: { pct: React.ReactNode; cost: string }) {
  return (
    <>
      {pct}
      {pct && cost ? <br /> : null}
      {cost ? `${cost} given up` : null}
    </>
  );
}
function Pct({ n, of, tone }: { n: number; of: number; tone: (pct: number) => string }) {
  const pct = of ? (100 * n) / of : 0;
  return (
    <>
      {/* The count beside the share — 15% says how big, "6 of 40" says of what. */}
      <span style={{ color: tone(pct), fontWeight: 600 }}>{Math.round(pct)}%</span>
      {" · "}
      <span className="tabular">{n.toLocaleString()} of {of.toLocaleString()}</span>
      {" registrations"}
    </>
  );
}

function Tile({ label, value, values, sub, accent }: {
  label: string; value?: string; values?: string[]; sub?: React.ReactNode; accent?: string;
}) {
  const figures = values ?? (value === undefined ? [] : [value]);
  return (
    <div className="rounded-xl bg-glass-surface px-4 py-3.5 min-w-0 shadow-card">
      <div className="text-xs font-bold text-glass-text-tertiary truncate">{label}</div>
      <div className="mt-1.5 space-y-0.5">
        {(figures.length ? figures : ["—"]).map((f, i) => (
          <div key={i} className="text-2xl font-bold tabular leading-tight" style={{ color: accent ?? "var(--glass-text)" }}>
            {f}
          </div>
        ))}
      </div>
      {sub && <div className="text-[11px] text-glass-text-tertiary mt-1 leading-snug">{sub}</div>}
    </div>
  );
}
