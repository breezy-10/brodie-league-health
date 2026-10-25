import { canonicalLocation, compareSeasons, csvParam, locParam, resolveScope } from "@/lib/seasons";
import Filters, { type FilterOptions } from "../dashboard/Filters";
import { requireUser } from "@/lib/auth";
import { promoFetch } from "@/lib/promo-feed";
import { BasisToggle } from "../dashboard/BasisToggle";
import ScheduledDropIns from "./ScheduledDropIns";
import AvailableDropIns from "./AvailableDropIns";
import MissingStatsDropIns from "./MissingStatsDropIns";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { type PlayersFilter, playersFilter } from "./players";
import { SectionSkeleton } from "../dashboard/Skeletons";
import { STICKY_TH_STYLE, stickyTh, tableScrollBox } from "../dashboard/stickyTable";

// Drop-ins: players who came for a single game rather than a season. A drop-in
// is free for a brand-new player (the First-Time Free code) and $50 for a
// returning one, so the page splits the two: for new players, how many became
// season registrations; for returning players, the price bridge the Discounts
// tab uses. Across both, how many actually showed up to their game. The Promo
// Tracker owns the ops-DB connection, so the figures come from its feed.
const PROMO_APP_URL = process.env.PROMO_APP_URL ?? "https://registration-promo-tracker.vercel.app";

export type DropInRow = {
  location: string;
  currency: string;
  dropins: number;
  players: number;
  repeat_players: number;
  list_price: number;
  discount: number;
  after_discount: number;
  fees: number;
  total_paid: number;
  revenue: number;
  discounted: number;
  free: number;
  discount_total: number;
  free_value: number;
  not_paid: number;
  cancelled: number;
  // New vs returning (absent from an older feed).
  new_dropins?: number;
  returning_dropins?: number;
  new_players?: number;
  returning_players?: number;
  converted_players?: number;
  // Of those, registered for the drop-in's own season, and for another one.
  converted_same_season?: number;
  converted_other_season?: number;
  // The same players by the season they registered for (absent from an older
  // feed).
  converted_by_season?: Record<string, number>;
  // Returning players who made a season registration after their drop-in,
  // split the same way (absent from an older feed).
  returning_converted_players?: number;
  returning_converted_same_season?: number;
  returning_converted_other_season?: number;
  returning_converted_by_season?: Record<string, number>;
  new_charged?: number;
  returning_free?: number;
  given_free?: number;
  returning_list_price?: number;
  returning_discount?: number;
  returning_fees?: number;
  returning_total_paid?: number;
  returning_revenue?: number;
  showed_up?: number;
  no_show?: number;
  awaiting_stats?: number;
  upcoming?: number;
};
export type DropInPeople = {
  players: number; repeat_players: number; new_players?: number; returning_players?: number; converted_players?: number;
  converted_same_season?: number; converted_other_season?: number;
  converted_by_season?: Record<string, number>;
  // Players who registered for two or more seasons, so counted under each
  // in the by-season counts (absent from an older feed).
  converted_multi_season?: number;
  returning_converted_players?: number;
  returning_converted_by_season?: Record<string, number>;
  returning_converted_multi_season?: number;
};
export type DropInFeed = {
  season: string;
  locations: DropInRow[];
  // A player who dropped in at two venues is one player, so these are counted
  // across venues by the feed rather than summed from the rows.
  players_by_currency: Record<string, DropInPeople>;
  // The same across both countries: someone who dropped in in Canada and the
  // US is one player (absent from an older feed).
  players_all?: DropInPeople;
  // What the players who registered for a season after a drop-in brought in:
  // their season registrations, full price before tax, per currency, split by
  // new and returning drop-ins (absent from an older feed).
  conversion_revenue?: Record<"new" | "returning", { registrations: number; by_currency: Record<string, number> }>;
  discount_codes: { code: string; currency: string; uses: number; given_up: number }[];
  truncated: boolean;
};

// when: only drop-ins for games already played, or still to come; every
// drop-in without it.
export async function loadDropIns(
  season: string, locationNames: string[] | null, when?: "past" | "upcoming", players: PlayersFilter = "both",
): Promise<DropInFeed | null> {
  try {
    const url = new URL("/api/drop-ins", PROMO_APP_URL);
    url.searchParams.set("season", season);
    if (when) url.searchParams.set("when", when);
    if (players !== "both") url.searchParams.set("players", players);
    const lp = locParam(locationNames);
    if (lp) url.searchParams.set("location", lp);
    const res = await promoFetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as DropInFeed;
    return k.locations ? k : null;
  } catch {
    return null;
  }
}

const ACCENT = "var(--glass-text)";
const LIST = "var(--viz-prev)"; // the grey the registration bars use for the prior season
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// An amount with its currency, "$50.00 CAD": Canada and the US share the page.
// A no-break space, so the code never wraps away from its amount.
const moneyIn = (n: number, cur: string) => `${money(n)}\u00a0${cur}`;
const pct = (n: number, of: number) => (of ? `${Math.round((100 * n) / of)}%` : "—");

export default async function DropInsView({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; location?: string; tab?: string; when?: string; by?: string; players?: string }>;
}) {
  await requireUser();
  const { season: seasonParam, location: locationParam, tab: tabParam, when: whenParam, by: byParam, players: playersParam } = await searchParams;
  // New players by default; returning, or both, when asked.
  const players = playersFilter(playersParam);
  // Past used to be a switch inside Scheduled; a link from then opens the tab.
  // A redirect rather than reading both, because the tab bar keeps every other
  // param and a leftover when=past would hold Scheduled on Past.
  if (tabParam === "scheduled" && whenParam === "past") {
    const q = new URLSearchParams();
    if (seasonParam) q.set("season", seasonParam);
    if (locationParam) q.set("location", locationParam);
    redirect(q.size ? `/drop-ins?${q}` : "/drop-ins");
  }
  // Past (the default) and Scheduled are the season in numbers for drop-ins
  // whose game has been played, or is still to come, with each drop-in by game
  // beneath. Available lists the upcoming games that still take drop-ins;
  // Missing stats lists drop-ins already played that have no stat line. An old
  // ?tab=overview or ?tab=past link lands on Past.
  const tab = tabParam === "scheduled" || tabParam === "available" || tabParam === "missing-stats" ? tabParam : "past";
  const isScheduled = tab === "scheduled";
  const isAvailable = tab === "available";
  const isMissing = tab === "missing-stats";
  const byLocation = byParam === "location";
  // Past and Scheduled list drop-ins by game unless asked for the day each
  // was registered.
  const byRegistered = !isAvailable && !isMissing && byParam === "registered";
  const selectedSeasons = csvParam(seasonParam);
  const selectedLocations = csvParam(locationParam).map(canonicalLocation);

  // A drop-in is a game in the season being played, so this defaults to the
  // playing season, not the one being registered for.
  const { filterLocations, promoSeasons, selectedSeason, locationNames } = await resolveScope(
    { season: selectedSeasons[0], locations: selectedLocations },
    { defaultSeason: "playing" },
  );

  const options: FilterOptions = {
    seasons: promoSeasons.map((s) => ({ value: s, label: s })),
    locations: filterLocations,
  };
  const when = isScheduled ? "upcoming" : "past";

  return (
    <main className="brodie-fade-in space-y-8">
      <p className="page-lede">
        Revenue is the drop-in price, $50 for a returning player, before processing fees. There is no sales tax
        anywhere on this page.
      </p>

      <Filters
        key={`${selectedSeasons.join(",")}|${selectedLocations.join(",")}`}
        options={options}
        current={{
          seasons: selectedSeasons.length ? selectedSeasons : [selectedSeason],
          locations: selectedLocations,
        }}
        keep={{
          ...(isScheduled ? { tab: "scheduled", ...(byRegistered ? { by: "registered" } : {}) }
            : isAvailable ? { tab: "available", ...(byLocation ? { by: "location" } : {}) }
            : isMissing ? { tab: "missing-stats" }
            : byRegistered ? { by: "registered" } : {}),
          ...(players !== "new" ? { players } : {}),
        }}
      />

      {/* Available lists open spots, which belong to no player, so it has no
          new or returning to pick. */}
      {/* Its own row: br-seg is inline, and would sit beside the tab bar. */}
      {!isAvailable && (
        <div>
          <BasisToggle
            param="players"
            value={players}
            defaultValue="new"
            options={[
              { value: "new", label: "New" },
              { value: "returning", label: "Returning" },
              { value: "both", label: "Both" },
            ]}
          />
        </div>
      )}

      <BasisToggle
        param="tab"
        value={tab}
        options={[
          { value: "past", label: "Past" },
          { value: "scheduled", label: "Scheduled" },
          { value: "available", label: "Available" },
          { value: "missing-stats", label: "Missing stats" },
        ]}
      />

      {isAvailable ? (
        <AvailableDropIns season={selectedSeason} locationNames={locationNames} byLocation={byLocation} />
      ) : isMissing ? (
        <MissingStatsDropIns season={selectedSeason} locationNames={locationNames} players={players} />
      ) : (
        <>
          {/* Both stream in on their own, so neither waits on the other's feed. */}
          <Suspense fallback={<SectionSkeleton title={isScheduled ? "Drop-ins to come" : "Drop-ins played"} />}>
            <DropInSummary season={selectedSeason} locationNames={locationNames} when={when} players={players} />
          </Suspense>
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold" style={{ color: "var(--glass-text)" }}>
                {byRegistered ? "By registration date" : "By game"}
              </h2>
              <BasisToggle
                param="by"
                value={byRegistered ? "registered" : "game"}
                options={[{ value: "game", label: "By game" }, { value: "registered", label: "By registration date" }]}
              />
            </div>
            <Suspense fallback={
              <div className="rounded-2xl bg-glass-surface p-5 space-y-3 shadow-card">
                {[92, 81, 70, 59].map((w) => <div key={w} className="h-3 rounded skeleton-pulse" style={{ width: `${w}%` }} />)}
              </div>
            }>
              <ScheduledDropIns season={selectedSeason} locationNames={locationNames} past={!isScheduled} byRegistered={byRegistered}
                players={players} />
            </Suspense>
          </section>
        </>
      )}
    </main>
  );
}

// The season in numbers, as the Overview tab had it, for the drop-ins whose
// game has been played (Past) or is still to come (Scheduled). Attendance only
// means something once a game is played, so Scheduled leaves it out.
async function DropInSummary({ season, locationNames, when, players }: {
  season: string;
  locationNames: string[] | null;
  when: "past" | "upcoming";
  players: PlayersFilter;
}) {
  const feed = await loadDropIns(season, locationNames, when, players);
  const past = when === "past";
  // The feed already holds only the chosen players; these hide what's left
  // empty, the other group's tiles and table columns.
  const showNew = players !== "returning";
  const showRet = players !== "new";
  const who = players === "new" ? " by new players" : players === "returning" ? " by returning players" : "";
  const selectedSeason = season;
  // Canada and the US together: counts are added up, but money never is. Every
  // amount carries its currency, and a total names each currency on its own.
  const locs = [...(feed?.locations ?? [])].sort((a, b) => a.location.localeCompare(b.location));
  const currencies = [...new Set(locs.map((r) => r.currency))].sort();

  if (!feed) {
    return (
      <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary shadow-card">
        Drop-in feed unavailable: the Promo Tracker didn&apos;t answer for {selectedSeason}.
      </div>
    );
  }
  if (!locs.length) {
    return (
      <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary shadow-card">
        {past
          ? `No drop-ins${who} for games played in ${selectedSeason} in this scope yet.`
          : `No drop-ins${who} for games still to come in ${selectedSeason} in this scope.`}
      </div>
    );
  }

  const n = locs.reduce((s, r) => s + r.dropins, 0);
  // Optional fields read as 0 from an older feed.
  const sum = (k: keyof DropInRow, cur?: string) =>
    locs.reduce((s, r) => s + (cur && r.currency !== cur ? 0 : ((r[k] as number | undefined) ?? 0)), 0);
  // One amount per currency on the page, each on its own line.
  const byCurrency = (amount: (cur: string) => number, prefix = ""): React.ReactNode =>
    currencies.map((cur) => <span key={cur} className="block">{prefix}{moneyIn(amount(cur), cur)}</span>);
  const people = feed.players_all ?? mergePeople(Object.values(feed.players_by_currency ?? {}));
  const newPlayers = people.new_players ?? sum("new_players");
  const retPlayers = people.returning_players ?? sum("returning_players");
  const converted = people.converted_players ?? sum("converted_players");
  const convertedSame = people.converted_same_season ?? sum("converted_same_season");
  const convertedOther = people.converted_other_season ?? sum("converted_other_season");
  // A returning player is one who had already played or registered;
  // this is the ones who registered for a season after their drop-in.
  const retConverted = people.returning_converted_players ?? sum("returning_converted_players");
  const newDropins = sum("new_dropins");
  const retDropins = sum("returning_dropins");
  // The returning players' price in one currency, weighted by their drop-ins.
  const rw = (k: keyof DropInRow, cur: string) => {
    const d = sum("returning_dropins", cur);
    return d ? locs.reduce((s, r) => s + (r.currency === cur ? ((r[k] as number) ?? 0) * (r.returning_dropins ?? 0) : 0), 0) / d : 0;
  };
  // Paid drop-ins: returning players' not let in free, and any new
  // player's that was charged. Their prices make up Revenue.
  const newCharged = sum("new_charged");
  const newFree = newDropins - newCharged;
  const retPaid = retDropins - sum("returning_free");
  const paidDropins = retPaid + newCharged;
  const showed = sum("showed_up");
  const noShow = sum("no_show");
  const notPaid = sum("not_paid");
  const cancelled = sum("cancelled");
  // Each venue's bar is against the highest venue in its own currency.
  const maxRevenue = new Map(currencies.map((cur) => [cur, Math.max(...locs.filter((r) => r.currency === cur).map((r) => r.revenue), 1)]));
  // A venue's name filters the page to it, keeping the season, players and tab.
  const locationHref = (location: string) => {
    const q = new URLSearchParams({ season, location });
    if (players !== "new") q.set("players", players);
    if (!past) q.set("tab", "scheduled");
    return `/drop-ins?${q}`;
  };
  // Right after the players column, so attendance reads before what they went on to do.
  const showedTd = (count: number, total: number, strong = false) => past && (
    <RateTd strong={strong} count={count} total={total}
      color={total ? showTone((100 * count) / total) : undefined} />
  );

  const showedTile = past && (
    <Tile label="Showed up" value={pct(showed, showed + noShow)}
      accent={showed + noShow ? showTone((100 * showed) / (showed + noShow)) : undefined}
      sub={
        <>
          {/* Out of the drop-ins whose team's stats are in, so
              the three lines add up to the drop-ins tile. */}
          <span className="block">{showed.toLocaleString()} of {(showed + noShow).toLocaleString()} drop-ins with stats in</span>
          <span className="block">{noShow.toLocaleString()} {noShow === 1 ? "no-show" : "no-shows"}</span>
          <span className="block">{sum("awaiting_stats").toLocaleString()} awaiting stats, not counted</span>
        </>
      } />
  );
  const revenueTile = (
    <Tile label="Drop-in revenue" value={byCurrency((cur) => sum("revenue", cur))} accent={ACCENT}
      sub={
        <>
          <span className="block">
            {paidDropins.toLocaleString()} paid {paidDropins === 1 ? "drop-in" : "drop-ins"}: {retPaid.toLocaleString()} returning, {newCharged.toLocaleString()} new
          </span>
          <span className="block">price after any discount, before processing fees</span>
        </>
      } />
  );
  const notPaidTile = (
    <Tile label="Started, not paid" value={notPaid.toLocaleString()}
      accent={notPaid ? "var(--amber-ink)" : undefined}
      sub={`${cancelled.toLocaleString()} cancelled`} />
  );
  const newDropinsTile = (
    <Tile label="Drop-ins" value={newDropins.toLocaleString()} accent={ACCENT}
      sub={
        <>
          <span className="block">by {newPlayers.toLocaleString()} new {newPlayers === 1 ? "player" : "players"}</span>
          <span className="block">
            {newFree.toLocaleString()} free
            {newCharged > 0 && <> · <span style={{ color: "var(--red)" }}>{newCharged.toLocaleString()} charged</span></>}
          </span>
        </>
      } />
  );
  const becameTile = (
    <Tile label="Became registrations" value={pct(converted, newPlayers)} accent={ACCENT}
      sub={!converted
        ? `0 of ${newPlayers.toLocaleString()} new players have registered for a season since`
        : people.converted_by_season
          ? convertedLines(converted, newPlayers, "new", people.converted_by_season, people.converted_multi_season)
          : `${converted.toLocaleString()} of ${newPlayers.toLocaleString()} new players registered for a season after: ${
              convertedSame.toLocaleString()} for ${selectedSeason}, ${convertedOther.toLocaleString()} for another season`} />
  );
  const givenFreeTile = (
    <Tile label="Drop-ins given free" value={byCurrency((cur) => sum("given_free", cur))}
      sub={`the drop-in price, waived on ${newFree.toLocaleString()} free ${newFree === 1 ? "drop-in" : "drop-ins"}`} />
  );
  // The season registrations new players made after their drop-in, and what
  // they brought in: the money the drop-ins led to.
  const newConv = feed.conversion_revenue?.new;
  const convRevenueTile = newConv && (
    <Tile label="Season registration revenue" value={byCurrency((cur) => newConv.by_currency[cur] ?? 0)} accent={ACCENT}
      sub={
        <>
          <span className="block">
            {newConv.registrations.toLocaleString()} season {newConv.registrations === 1 ? "registration" : "registrations"} by
            the {converted.toLocaleString()} new {converted === 1 ? "player" : "players"} who registered
          </span>
          <span className="block">full price before tax</span>
        </>
      } />
  );
  const retDropinsTile = (
    <Tile label="Drop-ins" value={retDropins.toLocaleString()} accent={ACCENT}
      sub={
        <>
          <span className="block">by {retPlayers.toLocaleString()} returning {retPlayers === 1 ? "player" : "players"}</span>
          {sum("returning_free") > 0 && (
            <span className="block" style={{ color: "var(--red)" }}>{sum("returning_free")} got in free</span>
          )}
        </>
      } />
  );
  const listTile = (
    <Tile label="List price" value={retDropins ? byCurrency((cur) => rw("returning_list_price", cur)) : "—"} accent={LIST}
      sub="before discount" />
  );
  const discountTile = (
    <Tile label="Discount" value={retDropins ? byCurrency((cur) => rw("returning_discount", cur), "−") : "—"}
      sub="averaged over returning drop-ins" />
  );
  // Before processing fees, like Revenue: the drop-in price returning players
  // brought in, summed.
  const retRevenueTile = (
    <Tile label="Drop-in revenue" value={byCurrency((cur) => sum("returning_revenue", cur))} accent={ACCENT}
      sub={`${retDropins.toLocaleString()} ${retDropins === 1 ? "drop-in" : "drop-ins"}, before processing fees`} />
  );
  const regAfterTile = (
    <Tile label="Registered after" value={pct(retConverted, retPlayers)} accent={ACCENT}
      sub={retConverted
        ? convertedLines(retConverted, retPlayers, "returning", people.returning_converted_by_season, people.returning_converted_multi_season)
        : `none of ${retPlayers.toLocaleString()} returning players has registered for a season since`} />
  );

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="text-lg font-semibold" style={{ color: "var(--glass-text)" }}>
            {past ? "Drop-ins played" : "Drop-ins to come"}
          </h2>
          <span className="text-xs text-glass-text-tertiary">
            {n.toLocaleString()} {n === 1 ? "drop-in" : "drop-ins"}{who} for {past ? "games played" : "games still to come"} · {selectedSeason}
          </span>
        </div>

        {/* New or Returning alone is one row of tiles: the group's own
            drop-ins tile (who was free) leads, and nothing repeats. Both keeps
            the totals, then a section for each group. */}
        {players === "both" ? (
          <>
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
              <Tile label="Drop-ins" value={n.toLocaleString()} accent={ACCENT}
                sub={
                  <>
                    <span className="block">{newDropins.toLocaleString()} by new players</span>
                    <span className="block">{retDropins.toLocaleString()} by returning players</span>
                  </>
                } />
              {showedTile}
              {revenueTile}
              {notPaidTile}
            </div>
            <SubHead title="New players" note="Free with First-Time Free" />
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
              {newDropinsTile}
              {becameTile}
              {convRevenueTile}
              {givenFreeTile}
            </div>
            <SubHead title="Returning players" note="Charged for each drop-in" />
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
              {retDropinsTile}
              {listTile}
              {discountTile}
              {retRevenueTile}
              {regAfterTile}
            </div>
          </>
        ) : players === "new" ? (
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            {newDropinsTile}
            {showedTile}
            {becameTile}
            {convRevenueTile}
            {revenueTile}
            {givenFreeTile}
            {notPaidTile}
          </div>
        ) : (
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            {retDropinsTile}
            {showedTile}
            {/* Revenue here is all returning players', so no second one. */}
            {revenueTile}
            {notPaidTile}
            {listTile}
            {discountTile}
            {regAfterTile}
          </div>
        )}

        <div className="rounded-2xl bg-glass-surface shadow-card">
          <div className={tableScrollBox(past ? 1200 : 1080)}>
            <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: past ? 1200 : 1080 }}>
              <thead>
                <tr className="text-xs font-bold text-glass-text-tertiary">
                  <Th align="left">Location</Th>
                  <Th>Drop-ins</Th>
                  {showNew && (
                    <>
                      <Th>New players</Th>
                      {past && <Th>Showed up</Th>}
                      <Th>Registered this season</Th>
                      <Th>Registered another season</Th>
                    </>
                  )}
                  {showRet && (
                    <>
                      <Th>Returning players</Th>
                      {past && !showNew && <Th>Showed up</Th>}
                      <Th>Returning who registered after</Th>
                      <Th>Returning revenue</Th>
                    </>
                  )}
                  <Th>Revenue</Th>
                  <Th>Not paid</Th>
                </tr>
              </thead>
              <tbody>
                {locs.map((r) => (
                  <tr key={r.location} style={{ borderTop: "1px solid var(--glass-border)" }}>
                    <td className="px-4 py-2.5 align-middle">
                      <Link href={locationHref(r.location)} className="block font-semibold truncate hover:underline"
                        style={{ color: "var(--glass-text)" }} title={`Show only ${r.location}`}>
                        {r.location}
                      </Link>
                      {/* Bar length = revenue against the highest venue in its currency. */}
                      <div className="mt-1.5 h-1.5 rounded-full overflow-hidden flex"
                        style={{ width: `${Math.max((r.revenue / (maxRevenue.get(r.currency) ?? 1)) * 100, 2)}%`, minWidth: 8 }}
                        title={`${moneyIn(r.revenue, r.currency)} collected`}>
                        <span style={{ width: "100%", background: "var(--glass-text)" }} />
                      </div>
                    </td>
                    <Td>
                      {r.dropins.toLocaleString()}
                      <CountLine n={r.players} one="player" many="players" />
                    </Td>
                    {showNew && (
                      <>
                        <Td>
                          {(r.new_players ?? 0).toLocaleString()}
                          <CountLine one="drop-in" many="drop-ins" n={r.new_dropins ?? 0} />
                        </Td>
                        {showedTd(r.showed_up ?? 0, (r.showed_up ?? 0) + (r.no_show ?? 0))}
                        <RateTd count={r.converted_same_season ?? 0} total={r.new_players ?? 0} />
                        <RateTd count={r.converted_other_season ?? 0} total={r.new_players ?? 0}
                          note={otherSeasons(r.converted_by_season, selectedSeason)} />
                      </>
                    )}
                    {showRet && (
                      <>
                        <Td>
                          {(r.returning_players ?? 0).toLocaleString()}
                          <CountLine one="drop-in" many="drop-ins" n={r.returning_dropins ?? 0} />
                        </Td>
                        {!showNew && showedTd(r.showed_up ?? 0, (r.showed_up ?? 0) + (r.no_show ?? 0))}
                        <RateTd count={r.returning_converted_players ?? 0} total={r.returning_players ?? 0}
                          note={r.returning_converted_by_season && Object.keys(r.returning_converted_by_season).length
                            ? seasonCounts(r.returning_converted_by_season) : null} />
                        <Td>{r.returning_dropins ? moneyIn(r.returning_revenue ?? 0, r.currency) : "—"}</Td>
                      </>
                    )}
                    <Td strong>{moneyIn(r.revenue, r.currency)}</Td>
                    <Td>
                      {r.not_paid.toLocaleString()}
                      {r.cancelled > 0 && (
                        <div className="text-[11px] font-normal text-glass-text-tertiary">{r.cancelled} cancelled</div>
                      )}
                    </Td>
                  </tr>
                ))}
                {/* A total of one row only repeats it. */}
                {locs.length > 1 && (
                  <tr style={{ borderTop: "2px solid var(--glass-border-light)" }}>
                    <td className="px-4 py-3 font-bold" style={{ color: "var(--glass-text)" }}>All locations</td>
                    <Td strong>
                      {n.toLocaleString()}
                      <CountLine n={people.players} one="player" many="players" />
                    </Td>
                    {showNew && (
                      <>
                        <Td strong>
                          {newPlayers.toLocaleString()}
                          <CountLine one="drop-in" many="drop-ins" n={newDropins} />
                        </Td>
                        {showedTd(showed, showed + noShow, true)}
                        <RateTd strong count={convertedSame} total={newPlayers} />
                        <RateTd strong count={convertedOther} total={newPlayers}
                          note={otherSeasons(people.converted_by_season, selectedSeason)} />
                      </>
                    )}
                    {showRet && (
                      <>
                        <Td strong>
                          {retPlayers.toLocaleString()}
                          <CountLine one="drop-in" many="drop-ins" n={retDropins} />
                        </Td>
                        {!showNew && showedTd(showed, showed + noShow, true)}
                        <RateTd strong count={retConverted} total={retPlayers}
                          note={people.returning_converted_by_season && Object.keys(people.returning_converted_by_season).length
                            ? seasonCounts(people.returning_converted_by_season) : null} />
                        <Td strong>{retDropins ? <MoneyLines amounts={currencies.map((cur) => [sum("returning_revenue", cur), cur])} /> : "—"}</Td>
                      </>
                    )}
                    <Td strong><MoneyLines amounts={currencies.map((cur) => [sum("revenue", cur), cur])} /></Td>
                    <Td strong>{notPaid.toLocaleString()}</Td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {feed.truncated && (
        <p className="text-xs" style={{ color: "var(--red)" }}>
          The ops database returned its row limit, so some drop-ins may be missing from these figures.
        </p>
      )}
    </div>
  );
}

// A total cell's amounts, one currency per line.
function MoneyLines({ amounts }: { amounts: [number, string][] }) {
  return <>{amounts.map(([v, cur]) => <div key={cur}>{moneyIn(v, cur)}</div>)}</>;
}

// The counts of several currencies' players added together, for an older feed
// without players_all (a player in both countries is counted twice there).
function mergePeople(list: DropInPeople[]): DropInPeople {
  const add = (k: keyof DropInPeople) => list.reduce((s, p) => s + ((p[k] as number | undefined) ?? 0), 0);
  const addSeasons = (k: "converted_by_season" | "returning_converted_by_season") => {
    const out: Record<string, number> = {};
    for (const p of list) for (const [s, v] of Object.entries(p[k] ?? {})) out[s] = (out[s] ?? 0) + v;
    return out;
  };
  return {
    players: add("players"), repeat_players: add("repeat_players"),
    new_players: add("new_players"), returning_players: add("returning_players"), converted_players: add("converted_players"),
    converted_same_season: add("converted_same_season"), converted_other_season: add("converted_other_season"),
    converted_by_season: addSeasons("converted_by_season"), converted_multi_season: add("converted_multi_season"),
    returning_converted_players: add("returning_converted_players"),
    returning_converted_by_season: addSeasons("returning_converted_by_season"),
    returning_converted_multi_season: add("returning_converted_multi_season"),
  };
}

// "1 for Fall '26, 2 for Winter '27": each season the converted players
// registered for, oldest first.
// The lines under a "registered after" tile: how many of how many, each
// season's own count of players, and how many registered for more than one
// season (they're in every season they registered for, so the season counts
// can add up to more than the players).
function convertedLines(
  converted: number, players: number, kind: string, bySeason: Record<string, number> | undefined, multi: number | undefined,
): React.ReactNode {
  const seasons = Object.keys(bySeason ?? {}).length;
  return (
    <>
      <span className="block">{converted.toLocaleString()} of {players.toLocaleString()} {kind} players registered for a season after</span>
      {bySeason && seasons > 0 && <span className="block">{seasonCounts(bySeason, " · ")}</span>}
      {!!multi && (
        <span className="block">
          {multi.toLocaleString()} registered for {seasons === 2 ? "both" : "more than one season"}
        </span>
      )}
    </>
  );
}
function seasonCounts(by: Record<string, number>, sep = ", "): string {
  return Object.entries(by)
    .sort((a, b) => compareSeasons(a[0], b[0]))
    .map(([season, n]) => `${n.toLocaleString()} for ${season}`)
    .join(sep);
}
// The seasons other than the drop-in's own, for the "another season" column.
function otherSeasons(by: Record<string, number> | undefined, own: string): string | null {
  const other = Object.fromEntries(Object.entries(by ?? {}).filter(([season]) => season !== own));
  return Object.keys(other).length ? seasonCounts(other) : null;
}

// Played games: most players showing is the point, so a low rate reads red.
function showTone(pctShowed: number): string {
  const p = Math.round(pctShowed);
  return p >= 80 ? "var(--green)" : p >= 50 ? "var(--amber-ink)" : "var(--red)";
}

function SubHead({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex items-baseline gap-2 pt-1">
      <h3 className="text-sm font-semibold" style={{ color: "var(--glass-text)" }}>{title}</h3>
      <span className="text-xs text-glass-text-tertiary">{note}</span>
    </div>
  );
}

function Th({ children, align = "right" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th className={`px-4 py-2.5 ${align === "left" ? "text-left" : "text-right"} font-bold ${stickyTh(1200)}`} style={STICKY_TH_STYLE}>
      {children}
    </th>
  );
}

function RateTd({ count, total, color, strong = false, note }: {
  count: number; total: number; color?: string; strong?: boolean;
  // A line under the count, e.g. which seasons.
  note?: string | null;
}) {
  return (
    <td className="px-4 py-2.5 text-right tabular whitespace-nowrap align-middle">
      <div style={{ color: color ?? "var(--glass-text)", fontWeight: strong ? 700 : 500 }}>{pct(count, total)}</div>
      <div className="text-[11px] text-glass-text-tertiary leading-snug">
        {count.toLocaleString()} of {total.toLocaleString()}
      </div>
      {note && <div className="text-[11px] text-glass-text-tertiary leading-snug">{note}</div>}
    </td>
  );
}

// The line under a count in the location table: the drop-ins under a player
// count, the players under a drop-in count.
function CountLine({ n, one, many }: { n: number; one: string; many: string }) {
  if (n <= 0) return null;
  return (
    <div className="text-[11px] font-normal text-glass-text-tertiary">
      {n.toLocaleString()} {n === 1 ? one : many}
    </div>
  );
}

function Td({ children, strong = false, color }: { children: React.ReactNode; strong?: boolean; color?: string }) {
  return (
    <td className="px-4 py-2.5 text-right tabular whitespace-nowrap align-middle"
      style={{ color: color ?? "var(--glass-text)", fontWeight: strong ? 700 : 500 }}>
      {children}
    </td>
  );
}


function Tile({ label, value, sub, accent }: {
  label: string; value: React.ReactNode; sub?: React.ReactNode; accent?: string;
}) {
  return (
    <div className="rounded-xl bg-glass-surface px-4 py-3.5 min-w-0 flex flex-col shadow-card">
      <div className="text-xs font-bold text-glass-text-tertiary truncate">{label}</div>
      <div className="mt-1.5 text-2xl font-bold tabular leading-tight" style={{ color: accent ?? "var(--glass-text)" }}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-glass-text-tertiary mt-1 leading-snug">{sub}</div>}
    </div>
  );
}
