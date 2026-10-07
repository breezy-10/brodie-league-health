import { canonicalLocation, csvParam, locParam, resolveScope } from "@/lib/seasons";
import Filters, { type FilterOptions } from "../dashboard/Filters";
import { requireUser } from "@/lib/auth";
import { promoFetch } from "@/lib/promo-feed";

// Drop-ins: players who came for a single game rather than a season. A drop-in
// is free for a brand-new player (the First-Time Free code) and $50 for a
// returning one, so the page splits the two: for new players, how many became
// season registrations; for returning players, the price bridge the Discounts
// tab uses. Across both, how many actually showed up to their game. The Promo
// Tracker owns the ops-DB connection, so the figures come from its feed.
const PROMO_APP_URL = process.env.PROMO_APP_URL ?? "https://registration-promo-tracker.vercel.app";

type DropInRow = {
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
type DropInFeed = {
  season: string;
  locations: DropInRow[];
  // A player who dropped in at two venues is one player, so these are counted
  // across venues by the feed rather than summed from the rows.
  players_by_currency: Record<string, {
    players: number; repeat_players: number; new_players?: number; returning_players?: number; converted_players?: number;
  }>;
  discount_codes: { code: string; currency: string; uses: number; given_up: number }[];
  truncated: boolean;
};

async function loadDropIns(season: string, locationNames: string[] | null): Promise<DropInFeed | null> {
  try {
    const url = new URL("/api/drop-ins", PROMO_APP_URL);
    url.searchParams.set("season", season);
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
  searchParams: Promise<{ season?: string; location?: string }>;
}) {
  await requireUser();
  const { season: seasonParam, location: locationParam } = await searchParams;
  const selectedSeasons = csvParam(seasonParam);
  const selectedLocations = csvParam(locationParam).map(canonicalLocation);

  // A drop-in is a game in the season being played, so this defaults to the
  // playing season, not the one being registered for.
  const { filterLocations, promoSeasons, selectedSeason, locationNames } = await resolveScope(
    { season: selectedSeasons[0], locations: selectedLocations },
    { defaultSeason: "playing" },
  );
  const feed = await loadDropIns(selectedSeason, locationNames);

  const options: FilterOptions = {
    seasons: promoSeasons.map((s) => ({ value: s, label: s })),
    locations: filterLocations,
  };

  // Each currency is its own world, never mixed on one scale or summed.
  const currencies = [...new Set((feed?.locations ?? []).map((r) => r.currency))].sort();

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
      />

      {!feed ? (
        <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary shadow-card">
          Drop-in feed unavailable: the Promo Tracker didn&apos;t answer for {selectedSeason}.
        </div>
      ) : currencies.length === 0 ? (
        <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary shadow-card">
          No drop-ins for {selectedSeason} in this scope yet.
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
          const newDropins = sum("new_dropins");
          const retDropins = sum("returning_dropins");
          // The returning players' price, weighted by their drop-ins.
          const rw = (k: keyof DropInRow) =>
            retDropins ? locs.reduce((s, r) => s + ((r[k] as number) ?? 0) * (r.returning_dropins ?? 0), 0) / retDropins : 0;
          const showed = sum("showed_up");
          const noShow = sum("no_show");
          const notPaid = sum("not_paid");
          const cancelled = sum("cancelled");
          const codes = feed.discount_codes.filter((c) => c.currency === cur);
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
                  {n.toLocaleString()} drop-ins · {selectedSeason}
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
                <Tile label="Showed up" value={pct(showed, showed + noShow)}
                  accent={showed + noShow ? showTone((100 * showed) / (showed + noShow)) : undefined}
                  sub={
                    <>
                      <span className="block">{showed.toLocaleString()} of {(showed + noShow).toLocaleString()} games played</span>
                      <span className="block">{noShow.toLocaleString()} no-shows</span>
                      <span className="block">{sum("awaiting_stats").toLocaleString()} awaiting stats · {sum("upcoming").toLocaleString()} upcoming</span>
                    </>
                  } />
                <Tile label="Revenue" value={money(sum("revenue"))} accent={ACCENT} sub="drop-in price after any discount, before processing fees" />
                <Tile label="Started, not paid" value={notPaid.toLocaleString()}
                  accent={notPaid ? "var(--amber-ink)" : undefined}
                  sub={`${cancelled.toLocaleString()} cancelled`} />
              </div>

              <SubHead title="New players" note="Free with First-Time Free" />
              <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
                <Tile label="New players" value={newPlayers.toLocaleString()} accent={ACCENT}
                  sub={
                    <>
                      <span className="block">{newDropins.toLocaleString()} free {newDropins === 1 ? "drop-in" : "drop-ins"}</span>
                      {sum("new_charged") > 0 && (
                        <span className="block" style={{ color: "var(--red)" }}>{sum("new_charged")} charged</span>
                      )}
                    </>
                  } />
                <Tile label="Became registrations" value={pct(converted, newPlayers)} accent={ACCENT}
                  sub={`${converted.toLocaleString()} of ${newPlayers.toLocaleString()} new players registered for a season after`} />
                <Tile label="Given free" value={money(sum("given_free"))} sub="the drop-in price, waived" />
              </div>

              <SubHead title="Returning players" note="Charged for each drop-in" />
              <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
                <Tile label="Returning players" value={retPlayers.toLocaleString()} accent={ACCENT}
                  sub={
                    <>
                      <span className="block">{retDropins.toLocaleString()} {retDropins === 1 ? "drop-in" : "drop-ins"}</span>
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
                  <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: 1000 }}>
                    <thead>
                      <tr className="text-xs font-bold text-glass-text-tertiary">
                        <Th align="left">Location</Th>
                        <Th>Drop-ins</Th>
                        <Th>New players</Th>
                        <Th>Became registrations</Th>
                        <Th>Returning players</Th>
                        <Th>Returning revenue</Th>
                        <Th>Revenue</Th>
                        <Th>Showed up</Th>
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
                          <Td>{r.dropins.toLocaleString()}</Td>
                          <Td>{(r.new_players ?? 0).toLocaleString()}</Td>
                          <RateTd count={r.converted_players ?? 0} total={r.new_players ?? 0} />
                          <Td>
                            {(r.returning_players ?? 0).toLocaleString()}
                            {(r.returning_dropins ?? 0) > 0 && (
                              <div className="text-[11px] font-normal text-glass-text-tertiary">
                                {r.returning_dropins} {r.returning_dropins === 1 ? "drop-in" : "drop-ins"}
                              </div>
                            )}
                          </Td>
                          <Td>{r.returning_dropins ? money(r.returning_revenue ?? 0) : "—"}</Td>
                          <Td strong>{money(r.revenue)}</Td>
                          <RateTd count={r.showed_up ?? 0} total={(r.showed_up ?? 0) + (r.no_show ?? 0)}
                            color={(r.showed_up ?? 0) + (r.no_show ?? 0)
                              ? showTone((100 * (r.showed_up ?? 0)) / ((r.showed_up ?? 0) + (r.no_show ?? 0))) : undefined} />
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
                          <Td strong>{n.toLocaleString()}</Td>
                          <Td strong>{newPlayers.toLocaleString()}</Td>
                          <RateTd strong count={converted} total={newPlayers} />
                          <Td strong>{retPlayers.toLocaleString()}</Td>
                          <Td strong>{retDropins ? money(sum("returning_revenue")) : "—"}</Td>
                          <Td strong>{money(sum("revenue"))}</Td>
                          <RateTd strong count={showed} total={showed + noShow}
                            color={showed + noShow ? showTone((100 * showed) / (showed + noShow)) : undefined} />
                          <Td strong>{notPaid.toLocaleString()}</Td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {codes.length > 0 && (
                <div className="rounded-2xl bg-glass-surface overflow-hidden shadow-card">
                  <div className="px-4 pt-3.5 pb-2 text-sm font-semibold" style={{ color: "var(--glass-text)" }}>
                    Discount codes used
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: 420 }}>
                      <thead>
                        <tr className="text-xs font-bold text-glass-text-tertiary">
                          <Th align="left">Code</Th>
                          <Th>Uses</Th>
                          <Th>Given up</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {codes.map((c) => (
                          <tr key={c.code} style={{ borderTop: "1px solid var(--glass-border)" }}>
                            <td className="px-4 py-2.5" style={{ color: "var(--glass-text)" }}>{c.code}</td>
                            <Td>{c.uses.toLocaleString()}</Td>
                            <Td>{money(c.given_up)}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          );
        })
      )}

      {feed?.truncated && (
        <p className="text-xs" style={{ color: "var(--red)" }}>
          The ops database returned its row limit, so some drop-ins may be missing from these figures.
        </p>
      )}

      <p className="text-xs text-glass-text-tertiary max-w-[80ch]">
        A drop-in is one player coming for a single game, and counts once it went through: confirmed and not
        cancelled. It is by a new player when, before it, they had no roster spot, no completed season registration
        and no earlier drop-in; new players&apos; drop-ins are meant to be free, returning players&apos; charged, so
        the price figures are measured on returning players&apos; drop-ins only. Became registrations is new drop-in
        players who completed a paid season registration after their drop-in. Showed up is measured on games already
        played: the player has a stat line or is marked as played. A no-show is a game whose stats are in for their
        team but not for them; a game with no stats for their team yet waits under awaiting stats.
        Started, not paid is drop-ins left as a draft or with a failed payment. Revenue, overall and for returning
        players, is the drop-in price after any discount and before processing fees. Prices are without sales tax.
        Drop-ins on a test code are left out. Currencies are never mixed or summed.
      </p>
    </main>
  );
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

function RateTd({ count, total, color, strong = false }: {
  count: number; total: number; color?: string; strong?: boolean;
}) {
  return (
    <td className="px-4 py-2.5 text-right tabular whitespace-nowrap align-middle">
      <div style={{ color: color ?? "var(--glass-text)", fontWeight: strong ? 700 : 500 }}>{pct(count, total)}</div>
      <div className="text-[11px] text-glass-text-tertiary leading-snug">
        {count.toLocaleString()} of {total.toLocaleString()}
      </div>
    </td>
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
