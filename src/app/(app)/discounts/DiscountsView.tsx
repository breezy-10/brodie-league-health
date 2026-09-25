import Link from "next/link";
import { canonicalLocation, csvParam, locParam, resolveScope } from "@/lib/seasons";
import Filters, { type FilterOptions } from "../dashboard/Filters";
import { discountTone, freeTone } from "./rates";
import { requireUser } from "@/lib/auth";

// The Promo Tracker owns the ops-DB (Metabase) connection, so the price
// figures come from its feed rather than being re-derived here — same pattern
// as the Registrations and Referrals tabs.
const PROMO_APP_URL = process.env.PROMO_APP_URL ?? "https://registration-promo-tracker.vercel.app";

export type DiscountRow = {
  season: string;
  location: string;
  currency: string;
  regs: number;
  list_price: number;
  discount: number;
  after_discount: number;
  fees: number;
  total_paid: number;
  discounted: number;
  free: number;
  discount_total: number;
  free_value: number;
};
type DiscountFeed = { season: string; seasons: string[]; trend: DiscountRow[]; locations: DiscountRow[] };

async function loadDiscounts(season: string, locationNames: string[] | null): Promise<DiscountFeed | null> {
  try {
    const url = new URL("/api/discounts", PROMO_APP_URL);
    url.searchParams.set("season", season);
    const lp = locParam(locationNames);
    if (lp) url.searchParams.set("location", lp);
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as DiscountFeed;
    return k.locations ? k : null;
  } catch {
    return null;
  }
}

const GOLD = "var(--glass-gold)";

const LIST = "#5B8AC4"; // the same blue the registration bars use for the prior season

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Drill-down to the per-player list, carrying the current season and either the
// row's own location or whatever the filter is already scoped to.
function playersHref(season: string, location?: string, freeOnly = false) {
  const p = new URLSearchParams({ season });
  if (location) p.set("location", location);
  if (freeOnly) p.set("free", "1");
  return `/discounts/players?${p}`;
}
const VIEW_BTN =
  "inline-flex items-center gap-1 rounded-md border border-glass-border px-2 py-1 text-[11px] font-semibold "
  + "text-glass-text-tertiary hover:text-glass-text hover:border-glass-gold hover:bg-glass-surface-hover transition whitespace-nowrap";

export default async function DiscountsView({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; location?: string; lm?: string }>;
}) {
  await requireUser();
  const { season: seasonParam, location: locationParam } = await searchParams;
  const selectedSeasons = csvParam(seasonParam);
  const selectedLocations = csvParam(locationParam).map(canonicalLocation);

  // Same default as Referrals: the season being registered for, since a price
  // and its discounts attach to the registration rather than the season played.
  const { promoLocations, promoSeasons, selectedSeason, locationNames } = await resolveScope(
    { season: selectedSeasons[0], locations: selectedLocations },
    { defaultSeason: "registration" },
  );
  const feed = await loadDiscounts(selectedSeason, locationNames);

  const options: FilterOptions = {
    seasons: promoSeasons.map((s) => ({ value: s, label: s })),
    locations: promoLocations,
  };

  // Each currency is its own world — never mixed on one scale or summed.
  const currencies = [...new Set((feed?.locations ?? []).map((r) => r.currency))].sort();

  return (
    <main className="brodie-fade-in space-y-8">
      <header>
        <p className="font-mono text-xs uppercase tracking-[0.18em] mb-1" style={{ color: GOLD }}>Discounts</p>
        <h1 className="text-3xl font-semibold tracking-tight" style={{ color: "var(--glass-text)" }}>
          Price and discounting
        </h1>
        <p className="text-sm mt-1.5 text-glass-text-tertiary max-w-[68ch]">
          What a registration is advertised at, what comes off, and what actually lands. List price is the
          subtotal — no sales tax anywhere on this page.
        </p>
      </header>

      <Filters
        key={`${selectedSeasons.join(",")}|${selectedLocations.join(",")}`}
        options={options}
        current={{
          seasons: selectedSeasons.length ? selectedSeasons : [selectedSeason],
          locations: selectedLocations,
        }}
      />

      {!feed ? (
        <div className="rounded-xl border border-glass-border bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary">
          Discount feed unavailable — the Promo Tracker didn&apos;t answer for {selectedSeason}.
        </div>
      ) : currencies.length === 0 ? (
        <div className="rounded-xl border border-glass-border bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary">
          No registrations for {selectedSeason} in this scope yet.
        </div>
      ) : (
        currencies.map((cur) => {
          // Alphabetical: a venue is looked up by name here, not ranked —
          // sorting by price made a location move between seasons.
          const locs = feed.locations
            .filter((r) => r.currency === cur)
            .sort((a, b) => a.location.localeCompare(b.location));
          const regs = locs.reduce((s, r) => s + r.regs, 0);
          // Weighted by registrations — a 13-registration venue must not pull
          // the average as hard as a 543-registration one.
          const w = (k: keyof DiscountRow) =>
            regs ? locs.reduce((s, r) => s + (r[k] as number) * r.regs, 0) / regs : 0;
          const discounted = locs.reduce((s, r) => s + r.discounted, 0);
          const free = locs.reduce((s, r) => s + r.free, 0);
          // Totals, not averages: what the season actually gave up.
          const discountTotal = locs.reduce((s, r) => s + (r.discount_total ?? 0), 0);
          const freeValue = locs.reduce((s, r) => s + (r.free_value ?? 0), 0);
          const maxPaid = Math.max(...locs.map((r) => r.total_paid), 1);

          return (
            <section key={cur} className="space-y-3">
              <div className="flex items-center gap-2.5">
                <h2 className="text-lg font-semibold" style={{ color: "var(--glass-text)" }}>
                  {cur === "CAD" ? "Canada" : cur === "USD" ? "United States" : cur}
                </h2>
                <span className="text-[10px] sm:text-[9px] uppercase tracking-[0.16em] font-bold px-1.5 py-0.5 rounded"
                  style={{ background: "var(--glass-gold-light, rgba(255,184,0,0.16))", color: GOLD }}>{cur}</span>
                <span className="text-xs text-glass-text-tertiary">
                  {regs.toLocaleString()} registrations · {selectedSeason}
                </span>
              </div>

              <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
                <Tile label="List price" value={money(w("list_price"))} accent={LIST} sub="before discount" />
                <Tile label="Discount" value={`−${money(w("discount"))}`} sub="averaged over everyone" />
                <Tile label="After discount" value={money(w("after_discount"))} sub="before fees" />
                <Tile label="Fees" value={`+${money(w("fees"))}`} />
                <Tile label="Total price" value={money(w("total_paid"))} accent={GOLD} sub="after discount, with fees" />
                <Tile label="Got a discount" value={regs ? `${Math.round((100 * discounted) / regs)}%` : "—"}
                  accent={regs ? discountTone((100 * discounted) / regs) : undefined}
                  sub={`${discounted.toLocaleString()} of ${regs.toLocaleString()} · ${money(discountTotal)} given up`}
                  href={playersHref(selectedSeason, locationNames?.join(","))} hrefLabel="View discounts" />
                {/* A free registration is a discount of 100%, so it is already
                    inside "got a discount" — the sub-label says so, because two
                    tiles side by side otherwise read as separate groups. */}
                <Tile label="Free" value={regs ? `${Math.round((100 * free) / regs)}%` : "—"}
                  accent={regs ? freeTone((100 * free) / regs) : undefined}
                  sub={`${free.toLocaleString()} of ${regs.toLocaleString()} · ${money(freeValue)} given up`}
                  href={playersHref(selectedSeason, locationNames?.join(","), true)} hrefLabel="View free" />
              </div>

              <div className="rounded-2xl border border-glass-border bg-glass-surface overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: 900 }}>
                    <thead>
                      <tr className="text-[11px] sm:text-[10px] uppercase tracking-[0.16em] font-bold text-glass-text-tertiary">
                        <Th align="left">Location</Th>
                        <Th>Regs</Th>
                        <Th>List price</Th>
                        <Th>Discount</Th>
                        <Th>After discount</Th>
                        <Th>Fees</Th>
                        <Th>Total price</Th>
                        <Th>Discounted</Th>
                        <Th>Free</Th>
                        <Th align="left"> </Th>
                      </tr>
                    </thead>
                    <tbody>
                      {locs.map((r) => (
                        <tr key={r.location} style={{ borderTop: "1px solid var(--glass-border)" }}>
                          <td className="px-4 py-2.5 align-middle">
                            <div className="font-semibold truncate" style={{ color: "var(--glass-text)" }} title={r.location}>
                              {r.location}
                            </div>
                            {/* Bar length = total price against the highest venue,
                                so price realised reads at a glance. */}
                            <div className="mt-1.5 h-1.5 rounded-full overflow-hidden flex"
                              style={{ width: `${Math.max((r.total_paid / maxPaid) * 100, 2)}%`, minWidth: 8 }}
                              title={`${money(r.total_paid)} total price per registration`}>
                              <span style={{ width: "100%", background: GOLD }} />
                            </div>
                          </td>
                          <Td>{r.regs.toLocaleString()}</Td>
                          <Td color={LIST}>{money(r.list_price)}</Td>
                          <Td>−{money(r.discount)}</Td>
                          <Td>{money(r.after_discount)}</Td>
                          <Td>+{money(r.fees)}</Td>
                          <Td strong color={GOLD}>{money(r.total_paid)}</Td>
                          <RateTd count={r.discounted} total={r.regs}
                            color={r.regs ? discountTone((100 * r.discounted) / r.regs) : undefined} />
                          <RateTd count={r.free} total={r.regs}
                            color={r.regs ? freeTone((100 * r.free) / r.regs) : undefined} />
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <Link href={playersHref(selectedSeason, r.location)} className={VIEW_BTN}>View discounts</Link>
                          </td>
                        </tr>
                      ))}
                      <tr style={{ borderTop: "2px solid var(--glass-border-light)" }}>
                        <td className="px-4 py-3 font-bold" style={{ color: "var(--glass-text)" }}>All locations</td>
                        <Td strong>{regs.toLocaleString()}</Td>
                        <Td strong color={LIST}>{money(w("list_price"))}</Td>
                        <Td strong>−{money(w("discount"))}</Td>
                        <Td strong>{money(w("after_discount"))}</Td>
                        <Td strong>+{money(w("fees"))}</Td>
                        <Td strong color={GOLD}>{money(w("total_paid"))}</Td>
                        <RateTd strong count={discounted} total={regs}
                          color={regs ? discountTone((100 * discounted) / regs) : undefined} />
                        <RateTd strong count={free} total={regs}
                          color={regs ? freeTone((100 * free) / regs) : undefined} />
                        <td className="px-4 py-3 whitespace-nowrap">
                          <Link href={playersHref(selectedSeason, locationNames?.join(","))} className={VIEW_BTN}>View discounts</Link>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          );
        })
      )}

      <p className="text-xs text-glass-text-tertiary max-w-[80ch]">
        Counts only registrations that went through (completed, not cancelled, paid or paying) — the same filter the
        Registrations and Referrals tabs use. List price is the invoice subtotal before any discount; total price is the
        invoice total minus sales tax, which is the figure the dashboard&apos;s per-athlete revenue uses. Two kinds of
        row are excluded because neither is an individual price: invoices above $500, which are a captain paying for a
        whole roster at once, and the teammates covered by such an invoice — their own registration records a 100%
        discount because the captain already paid. Averages are weighted by registrations, so a small venue does not
        pull them as hard as a large one. Currencies are never mixed or summed. A free registration is a
        100% discount, so every free one is also counted as discounted — the Free figures are a subset of
        the Discounted ones, not a separate group.
      </p>
    </main>
  );
}

function Th({ children, align = "right" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <th className={`px-4 py-2.5 ${align === "left" ? "text-left" : "text-right"} font-bold`}>{children}</th>;
}

// A rate reads very differently at 1 of 1 than at 340 of 3,400, so the cell
// carries the fraction the percentage came from.
function RateTd({ count, total, color, strong = false }: {
  count: number; total: number; color?: string; strong?: boolean;
}) {
  return (
    <td className="px-4 py-2.5 text-right tabular whitespace-nowrap align-middle">
      <div style={{ color: color ?? "var(--glass-text)", fontWeight: strong ? 700 : 500 }}>
        {total ? `${Math.round((100 * count) / total)}%` : "—"}
      </div>
      <div className="text-[11px] text-glass-text-tertiary leading-snug">
        {count.toLocaleString()} of {total.toLocaleString()}
      </div>
    </td>
  );
}

function Td({ children, strong = false, color }: { children: React.ReactNode; strong?: boolean; color?: string }) {
  return (
    <td className="px-4 py-2.5 text-right tabular whitespace-nowrap"
      style={{ color: color ?? "var(--glass-text)", fontWeight: strong ? 700 : 500 }}>
      {children}
    </td>
  );
}

function Tile({ label, value, sub, accent, href, hrefLabel }: {
  label: string; value: string; sub?: string; accent?: string; href?: string; hrefLabel?: string;
}) {
  return (
    <div className="rounded-xl border border-glass-border bg-glass-surface px-4 py-3.5 min-w-0 flex flex-col">
      <div className="text-[11px] sm:text-[10px] uppercase tracking-[0.16em] font-bold text-glass-text-tertiary truncate">{label}</div>
      <div className="mt-1.5 text-2xl font-bold tabular leading-tight" style={{ color: accent ?? "var(--glass-text)" }}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-glass-text-tertiary mt-1 leading-snug">{sub}</div>}
      {href && (
        <div className="mt-2 flex justify-end">
          <Link href={href} className={VIEW_BTN}>{hrefLabel ?? "View"}</Link>
        </div>
      )}
    </div>
  );
}
