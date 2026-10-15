import { canonicalLocation, compareSeasons, csvParam, locParam, resolveScope } from "@/lib/seasons";
import Filters, { type FilterOptions } from "../dashboard/Filters";
import { requireUser } from "@/lib/auth";
import { promoFetch } from "@/lib/promo-feed";
import { BasisToggle } from "../dashboard/BasisToggle";
import ScheduledDropIns from "./ScheduledDropIns";
import AvailableDropIns from "./AvailableDropIns";
import MissingStatsDropIns from "./MissingStatsDropIns";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SectionSkeleton } from "../dashboard/Skeletons";

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
export type DropInFeed = {
  season: string;
  locations: DropInRow[];
  // A player who dropped in at two venues is one player, so these are counted
  // across venues by the feed rather than summed from the rows.
  players_by_currency: Record<string, {
    players: number; repeat_players: number; new_players?: number; returning_players?: number; converted_players?: number;
    converted_same_season?: number; converted_other_season?: number;
    converted_by_season?: Record<string, number>;
  }>;
  discount_codes: { code: string; currency: string; uses: number; given_up: number }[];
  truncated: boolean;
};

// when: only drop-ins for games already played, or still to come; every
// drop-in without it.
export async function loadDropIns(
  season: string, locationNames: string[] | null, when?: "past" | "upcoming",
): Promise<DropInFeed | null> {
  try {
    const url = new URL("/api/drop-ins", PROMO_APP_URL);
    url.searchParams.set("season", season);
    if (when) url.searchParams.set("when", when);
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
const pct = (n: number, of: number) => (of ? `${Math.round((100 * n) / of)}%` : "—");

export default async function DropInsView({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; location?: string; tab?: string; when?: string; by?: string }>;
}) {
  await requireUser();
  const { season: seasonParam, location: locationParam, tab: tabParam, when: whenParam, by: byParam } = await searchParams;
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
        keep={isScheduled ? { tab: "scheduled" }
          : isAvailable ? { tab: "available", ...(byLocation ? { by: "location" } : {}) }
          : isMissing ? { tab: "missing-stats" } : undefined}
      />

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
        <MissingStatsDropIns season={selectedSeason} locationNames={locationNames} />
      ) : (
        <>
          {/* Both stream in on their own, so neither waits on the other's feed. */}
          <Suspense fallback={<SectionSkeleton title={isScheduled ? "Drop-ins to come" : "Drop-ins played"} />}>
            <DropInSummary season={selectedSeason} locationNames={locationNames} when={when} />
          </Suspense>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold" style={{ color: "var(--glass-text)" }}>By game</h2>
            <Suspense fallback={
              <div className="rounded-2xl bg-glass-surface p-5 space-y-3 shadow-card">
                {[92, 81, 70, 59].map((w) => <div key={w} className="h-3 rounded skeleton-pulse" style={{ width: `${w}%` }} />)}
              </div>
            }>
              <ScheduledDropIns season={selectedSeason} locationNames={locationNames} past={!isScheduled} />
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
async function DropInSummary({ season, locationNames, when }: {
  season: string;
  locationNames: string[] | null;
  when: "past" | "upcoming";
}) {
  const feed = await loadDropIns(season, locationNames, when);
  const past = when === "past";
  const selectedSeason = season;
  // Each currency is its own world, never mixed on one scale or summed.
  const currencies = [...new Set((feed?.locations ?? []).map((r) => r.currency))].sort();

  return (
    <div className="space-y-8">
      {!feed ? (
        <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary shadow-card">
          Drop-in feed unavailable: the Promo Tracker didn&apos;t answer for {selectedSeason}.
        </div>
      ) : currencies.length === 0 ? (
        <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary shadow-card">
          {past
            ? `No drop-ins for games played in ${selectedSeason} in this scope yet.`
            : `No drop-ins for games still to come in ${selectedSeason} in this scope.`}
        </div>
      ) : (
        currencies.map((cur) => {
          const locs = feed.locations
            .filter((r) => r.currency === cur)
            .sort((a, b) => a.location.localeCompare(b.location));
          const n = locs.reduce((s, r) => s + r.dropins, 0);
          // Optional fields read as 0 from an older feed.
          const sum = (k: keyof DropInRow) => locs.reduce((s, r) => s + ((r[k] as number | undefined) ?? 0), 0);
          const people = feed.players_by_currency[cur] ?? { players: sum("players"), repeat_players: sum("repeat_players") };
          const newPlayers = people.new_players ?? sum("new_players");
          const retPlayers = people.returning_players ?? sum("returning_players");
          const converted = people.converted_players ?? sum("converted_players");
          const convertedSame = people.converted_same_season ?? sum("converted_same_season");
          const convertedOther = people.converted_other_season ?? sum("converted_other_season");
          const newDropins = sum("new_dropins");
          const retDropins = sum("returning_dropins");
          // The returning players' price, weighted by their drop-ins.
          const rw = (k: keyof DropInRow) =>
            retDropins ? locs.reduce((s, r) => s + ((r[k] as number) ?? 0) * (r.returning_dropins ?? 0), 0) / retDropins : 0;
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
          const maxRevenue = Math.max(...locs.map((r) => r.revenue), 1);

          return (
            <section key={cur} className="space-y-3">
              <div className="flex items-center gap-2.5">
                <h2 className="text-lg font-semibold" style={{ color: "var(--glass-text)" }}>
                  {cur === "CAD" ? "Canada" : cur === "USD" ? "United States" : cur}
                </h2>
                <span className="text-[11px] font-bold px-1.5 py-0.5 rounded"
                  style={{ background: "var(--fill-3)", color: "var(--glass-text-secondary)" }}>{cur}</span>
                <span className="text-xs text-glass-text-tertiary">
                  {n.toLocaleString()} {n === 1 ? "drop-in" : "drop-ins"} for {past ? "games played" : "games still to come"} · {selectedSeason}
                </span>
              </div>

              <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
                <Tile label="Drop-ins" value={n.toLocaleString()} accent={ACCENT}
                  sub={
                    <>
                      <span className="block">{newDropins.toLocaleString()} by new players</span>
                      <span className="block">{retDropins.toLocaleString()} by returning players</span>
                    </>
                  } />
                {past && (
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
                )}
                <Tile label="Revenue" value={money(sum("revenue"))} accent={ACCENT}
                  sub={
                    <>
                      <span className="block">
                        {paidDropins.toLocaleString()} paid {paidDropins === 1 ? "drop-in" : "drop-ins"}: {retPaid.toLocaleString()} returning, {newCharged.toLocaleString()} new
                      </span>
                      <span className="block">price after any discount, before processing fees</span>
                    </>
                  } />
                <Tile label="Started, not paid" value={notPaid.toLocaleString()}
                  accent={notPaid ? "var(--amber-ink)" : undefined}
                  sub={`${cancelled.toLocaleString()} cancelled`} />
              </div>

              <SubHead title="New players" note="Free with First-Time Free" />
              <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
                {/* Drop-ins first, then who made them, as the tile at the top. */}
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
                <Tile label="Became registrations" value={pct(converted, newPlayers)} accent={ACCENT}
                  sub={converted
                    ? `${converted.toLocaleString()} of ${newPlayers.toLocaleString()} new players registered for a season after: ${
                        people.converted_by_season
                          ? seasonCounts(people.converted_by_season)
                          : `${convertedSame.toLocaleString()} for ${selectedSeason}, ${convertedOther.toLocaleString()} for another season`}`
                    : `0 of ${newPlayers.toLocaleString()} new players have registered for a season since`} />
                <Tile label="Given free" value={money(sum("given_free"))}
                  sub={`the drop-in price, waived on ${newFree.toLocaleString()} free ${newFree === 1 ? "drop-in" : "drop-ins"}`} />
              </div>

              <SubHead title="Returning players" note="Charged for each drop-in" />
              <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
                <Tile label="Drop-ins" value={retDropins.toLocaleString()} accent={ACCENT}
                  sub={
                    <>
                      <span className="block">by {retPlayers.toLocaleString()} returning {retPlayers === 1 ? "player" : "players"}</span>
                      {sum("returning_free") > 0 && (
                        <span className="block" style={{ color: "var(--red)" }}>{sum("returning_free")} got in free</span>
                      )}
                    </>
                  } />
                <Tile label="List price" value={retDropins ? money(rw("returning_list_price")) : "—"} accent={LIST} sub="before discount" />
                <Tile label="Discount" value={retDropins ? `−${money(rw("returning_discount"))}` : "—"} sub="averaged over returning drop-ins" />
                {/* Before processing fees, like Revenue above: the drop-in price
                    returning players brought in, summed. */}
                <Tile label="Revenue" value={money(sum("returning_revenue"))} accent={ACCENT}
                  sub={`${retDropins.toLocaleString()} ${retDropins === 1 ? "drop-in" : "drop-ins"}, before processing fees`} />
              </div>

              <div className="rounded-2xl bg-glass-surface overflow-hidden shadow-card">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: past ? 1100 : 980 }}>
                    <thead>
                      <tr className="text-xs font-bold text-glass-text-tertiary">
                        <Th align="left">Location</Th>
                        <Th>Drop-ins</Th>
                        <Th>New players</Th>
                        <Th>Registered this season</Th>
                        <Th>Registered another season</Th>
                        <Th>Returning players</Th>
                        <Th>Returning revenue</Th>
                        <Th>Revenue</Th>
                        {past && <Th>Showed up</Th>}
                        <Th>Not paid</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {locs.map((r) => (
                        <tr key={r.location} style={{ borderTop: "1px solid var(--glass-border)" }}>
                          <td className="px-4 py-2.5 align-middle">
                            <div className="font-semibold truncate" style={{ color: "var(--glass-text)" }} title={r.location}>
                              {r.location}
                            </div>
                            {/* Bar length = revenue against the highest venue. */}
                            <div className="mt-1.5 h-1.5 rounded-full overflow-hidden flex"
                              style={{ width: `${Math.max((r.revenue / maxRevenue) * 100, 2)}%`, minWidth: 8 }}
                              title={`${money(r.revenue)} collected`}>
                              <span style={{ width: "100%", background: "var(--glass-text)" }} />
                            </div>
                          </td>
                          <Td>
                            {r.dropins.toLocaleString()}
                            <CountLine n={r.players} one="player" many="players" />
                          </Td>
                          <Td>
                            {(r.new_players ?? 0).toLocaleString()}
                            <CountLine one="drop-in" many="drop-ins" n={r.new_dropins ?? 0} />
                          </Td>
                          <RateTd count={r.converted_same_season ?? 0} total={r.new_players ?? 0} />
                          <RateTd count={r.converted_other_season ?? 0} total={r.new_players ?? 0}
                            note={otherSeasons(r.converted_by_season, selectedSeason)} />
                          <Td>
                            {(r.returning_players ?? 0).toLocaleString()}
                            <CountLine one="drop-in" many="drop-ins" n={r.returning_dropins ?? 0} />
                          </Td>
                          <Td>{r.returning_dropins ? money(r.returning_revenue ?? 0) : "—"}</Td>
                          <Td strong>{money(r.revenue)}</Td>
                          {past && (
                            <RateTd count={r.showed_up ?? 0} total={(r.showed_up ?? 0) + (r.no_show ?? 0)}
                              color={(r.showed_up ?? 0) + (r.no_show ?? 0)
                                ? showTone((100 * (r.showed_up ?? 0)) / ((r.showed_up ?? 0) + (r.no_show ?? 0))) : undefined} />
                          )}
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
                          <Td strong>
                            {newPlayers.toLocaleString()}
                            <CountLine one="drop-in" many="drop-ins" n={newDropins} />
                          </Td>
                          <RateTd strong count={convertedSame} total={newPlayers} />
                          <RateTd strong count={convertedOther} total={newPlayers}
                            note={otherSeasons(people.converted_by_season, selectedSeason)} />
                          <Td strong>
                            {retPlayers.toLocaleString()}
                            <CountLine one="drop-in" many="drop-ins" n={retDropins} />
                          </Td>
                          <Td strong>{retDropins ? money(sum("returning_revenue")) : "—"}</Td>
                          <Td strong>{money(sum("revenue"))}</Td>
                          {past && (
                            <RateTd strong count={showed} total={showed + noShow}
                              color={showed + noShow ? showTone((100 * showed) / (showed + noShow)) : undefined} />
                          )}
                          <Td strong>{notPaid.toLocaleString()}</Td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          );
        })
      )}

      {feed?.truncated && (
        <p className="text-xs" style={{ color: "var(--red)" }}>
          The ops database returned its row limit, so some drop-ins may be missing from these figures.
        </p>
      )}
    </div>
  );
}

// "1 for Fall '26, 2 for Winter '27": each season the converted players
// registered for, oldest first.
function seasonCounts(by: Record<string, number>): string {
  return Object.entries(by)
    .sort((a, b) => compareSeasons(a[0], b[0]))
    .map(([season, n]) => `${n.toLocaleString()} for ${season}`)
    .join(", ");
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
  return <th className={`px-4 py-2.5 ${align === "left" ? "text-left" : "text-right"} font-bold`}>{children}</th>;
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
  label: string; value: string; sub?: React.ReactNode; accent?: string;
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
