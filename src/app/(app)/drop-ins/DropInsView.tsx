import { canonicalLocation, csvParam, locParam, resolveScope } from "@/lib/seasons";
import Filters, { type FilterOptions } from "../dashboard/Filters";
import { discountTone, freeTone } from "../discounts/rates";
import { requireUser } from "@/lib/auth";
import { promoFetch } from "@/lib/promo-feed";

// Drop-ins: players who paid for a single game rather than a season. Laid out
// like the Discounts tab (the same price bridge, per currency, per location),
// with what is particular to a drop-in alongside: how many players, how many
// came back, and how many started one without paying. The Promo Tracker owns
// the ops-DB connection, so the figures come from its feed.
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
};
type DropInFeed = {
  season: string;
  locations: DropInRow[];
  // A player who dropped in at two venues is one player, so these are counted
  // across venues by the feed rather than summed from the rows.
  players_by_currency: Record<string, { players: number; repeat_players: number }>;
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
      <p className="page-lede">List price is the subtotal. There is no sales tax anywhere on this page.</p>

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
          // Weighted by drop-ins, so a venue with two doesn't pull the average
          // as hard as one with twenty.
          const w = (k: keyof DropInRow) => (n ? locs.reduce((s, r) => s + (r[k] as number) * r.dropins, 0) / n : 0);
          const sum = (k: keyof DropInRow) => locs.reduce((s, r) => s + (r[k] as number), 0);
          const people = feed.players_by_currency[cur] ?? { players: sum("players"), repeat_players: sum("repeat_players") };
          const discounted = sum("discounted");
          const free = sum("free");
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

              <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
                <Tile label="Drop-ins" value={n.toLocaleString()} accent={ACCENT}
                  sub={
                    <>
                      <span className="block">{people.players.toLocaleString()} {people.players === 1 ? "player" : "players"}</span>
                      <span className="block">{people.repeat_players.toLocaleString()} came back for another</span>
                    </>
                  } />
                <Tile label="List price" value={money(w("list_price"))} accent={LIST} sub="before discount" />
                <Tile label="Discount" value={`−${money(w("discount"))}`} sub="averaged over everyone" />
                <Tile label="After discount" value={money(w("after_discount"))} sub="before fees" />
                <Tile label="Fees" value={`+${money(w("fees"))}`} />
                <Tile label="Total price" value={money(w("total_paid"))} accent={ACCENT} sub="after discount, with fees" />
                <Tile label="Revenue" value={money(sum("revenue"))} accent={ACCENT} sub="collected, without sales tax" />
                <Tile label="Got a discount" value={pct(discounted, n)}
                  accent={n ? discountTone((100 * discounted) / n) : undefined}
                  sub={<CountCost n={discounted} of={n} cost={sum("discount_total")} />} />
                {/* Free is a 100% discount, so these are inside "got a discount"
                    too, not a separate group. */}
                <Tile label="Free" value={pct(free, n)}
                  accent={n ? freeTone((100 * free) / n) : undefined}
                  sub={<CountCost n={free} of={n} cost={sum("free_value")} />} />
                <Tile label="Started, not paid" value={notPaid.toLocaleString()}
                  accent={notPaid ? "var(--glass-warning-text, var(--amber-ink))" : undefined}
                  sub={`${cancelled.toLocaleString()} cancelled`} />
              </div>

              <div className="rounded-2xl bg-glass-surface overflow-hidden shadow-card">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: 1000 }}>
                    <thead>
                      <tr className="text-xs font-bold text-glass-text-tertiary">
                        <Th align="left">Location</Th>
                        <Th>Drop-ins</Th>
                        <Th>Players</Th>
                        <Th>List price</Th>
                        <Th>Discount</Th>
                        <Th>After discount</Th>
                        <Th>Fees</Th>
                        <Th>Total price</Th>
                        <Th>Revenue</Th>
                        <Th>Discounted</Th>
                        <Th>Free</Th>
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
                          <Td>
                            {r.players.toLocaleString()}
                            {r.repeat_players > 0 && (
                              <div className="text-[11px] font-normal text-glass-text-tertiary">{r.repeat_players} came back</div>
                            )}
                          </Td>
                          <Td color={LIST}>{r.dropins ? money(r.list_price) : "—"}</Td>
                          <Td>{r.dropins ? `−${money(r.discount)}` : "—"}</Td>
                          <Td>{r.dropins ? money(r.after_discount) : "—"}</Td>
                          <Td>{r.dropins ? `+${money(r.fees)}` : "—"}</Td>
                          <Td strong>{r.dropins ? money(r.total_paid) : "—"}</Td>
                          <Td strong>{money(r.revenue)}</Td>
                          <RateTd count={r.discounted} total={r.dropins}
                            color={r.dropins ? discountTone((100 * r.discounted) / r.dropins) : undefined} />
                          <RateTd count={r.free} total={r.dropins}
                            color={r.dropins ? freeTone((100 * r.free) / r.dropins) : undefined} />
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
                          <Td strong>{people.players.toLocaleString()}</Td>
                          <Td strong color={LIST}>{money(w("list_price"))}</Td>
                          <Td strong>−{money(w("discount"))}</Td>
                          <Td strong>{money(w("after_discount"))}</Td>
                          <Td strong>+{money(w("fees"))}</Td>
                          <Td strong>{money(w("total_paid"))}</Td>
                          <Td strong>{money(sum("revenue"))}</Td>
                          <RateTd strong count={discounted} total={n}
                            color={n ? discountTone((100 * discounted) / n) : undefined} />
                          <RateTd strong count={free} total={n}
                            color={n ? freeTone((100 * free) / n) : undefined} />
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
        A drop-in is one player paying for a single game. It counts once it went through: confirmed and not cancelled.
        Started, not paid counts drop-ins left as a draft or with a failed payment, and not cancelled. Price figures
        come from the invoice, without sales tax, as on the Discounts tab; a drop-in made free by a code with no
        invoice counts at its list price, fully discounted. Drop-ins on a test code are left out. Averages are
        weighted by drop-ins. Players counts each person once; came back is a player with more than one drop-in.
        Currencies are never mixed or summed.
      </p>
    </main>
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

function CountCost({ n, of, cost }: { n: number; of: number; cost: number }) {
  return (
    <>
      <span className="block whitespace-nowrap">{n.toLocaleString()} of {of.toLocaleString()}</span>
      <span className="block whitespace-nowrap">{money(cost)} given up</span>
    </>
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
