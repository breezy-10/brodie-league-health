import Link from "next/link";

// One location's discounts for the season, from the Promo Tracker's
// /api/discounts (the Discounts tab's own feed, so the numbers agree).
export type LeaderRow = {
  location: string;
  currency: string;
  regs: number;
  list_price: number;
  // Exact total list price; an older feed only has the per-registration
  // average, multiplied back below.
  list_total?: number;
  discounted: number;
  free: number;
  discount_total: number;
  free_value: number;
  other_discounted: number;
  other_discount_total: number;
  referral_discounted: number;
  referral_discount_total: number;
  returning_discounted: number;
  returning_discount_total: number;
};

export type LeaderSort = "volume" | "share";
type Kind = "returning" | "referral" | "other" | null;

const GOLD = "var(--glass-gold)";
const COUNTRY: Record<string, string> = { CAD: "Canada", USD: "United States" };
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number, of: number, digits = 0) => (of ? `${((100 * n) / of).toFixed(digits)}%` : "—");

// Column widths in percent, the same in every currency's card so they line up:
// rank, location, registrations, the four kinds (returning, referral, other,
// free), list price, discount, share.
const COLS: [string, number][] = [
  ["rank", 4], ["location", 17], ["regs", 9], ["returning", 10], ["referral", 10], ["other", 10],
  ["free", 9], ["list", 11], ["discount", 11], ["share", 9],
];

// Locations ranked from the most discount to the least, one card per currency
// (dollars in two currencies are never compared or added). Sorted by what was
// given up, or by that as a share of the location's total list price. When the
// page is narrowed to one kind of discount, or to free registrations, that is
// what the board ranks.
export default function DiscountLeaderboard({ rows, sort, kind, freeOnly, linkFor }: {
  rows: LeaderRow[];
  sort: LeaderSort;
  kind: Kind;
  freeOnly: boolean;
  // Where a location's name links: its own team view.
  linkFor: (location: string, currency: string) => string;
}) {
  const given = (r: LeaderRow) =>
    freeOnly ? { n: r.free, amount: r.free_value }
      : kind === "returning" ? { n: r.returning_discounted, amount: r.returning_discount_total }
      : kind === "referral" ? { n: r.referral_discounted, amount: r.referral_discount_total }
      : kind === "other" ? { n: r.other_discounted, amount: r.other_discount_total }
      : { n: r.discounted, amount: r.discount_total };
  const listOf = (r: LeaderRow) => r.list_total ?? r.list_price * r.regs;
  const share = (r: LeaderRow) => (listOf(r) ? given(r).amount / listOf(r) : 0);
  const key = (r: LeaderRow) => (sort === "share" ? share(r) : given(r).amount);

  const currencies = [...new Set(rows.map((r) => r.currency))].sort();
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary shadow-card">
        No registrations in this scope.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {currencies.map((cur) => {
        const ranked = rows
          .filter((r) => r.currency === cur)
          .sort((a, b) => key(b) - key(a) || given(b).amount - given(a).amount || a.location.localeCompare(b.location));
        const totalGiven = ranked.reduce((n, r) => n + given(r).amount, 0);
        const totalList = ranked.reduce((n, r) => n + listOf(r), 0);
        return (
          <div key={cur} className="rounded-2xl bg-glass-surface overflow-hidden shadow-card">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5"
              style={{ borderBottom: "1px solid var(--glass-border)" }}>
              <span className="text-sm font-bold" style={{ color: "var(--glass-text)" }}>
                {COUNTRY[cur] ?? cur} · {ranked.length} location{ranked.length === 1 ? "" : "s"}
              </span>
              <span className="ml-auto text-xs text-glass-text-tertiary tabular">
                {money(totalGiven)} {cur} given up · {pct(totalGiven, totalList, 1)} of {money(totalList)} list price
              </span>
            </div>
            {/* Scrolls in its own box so the header row stays in view, like the
                team view's cards. */}
            <div className="overflow-x-auto" style={{ maxHeight: "max(460px, calc(100vh - var(--shell-top) - 120px))" }}>
              <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: 1100, tableLayout: "fixed" }}>
                <colgroup>
                  {COLS.map(([k, w]) => <col key={k} style={{ width: `${w}%` }} />)}
                </colgroup>
                <thead>
                  <tr className="text-xs font-bold text-glass-text-tertiary">
                    <Th align="left">#</Th>
                    <Th align="left">Location</Th>
                    <Th>Registrations</Th>
                    <Th>Returning player</Th>
                    <Th>Referral</Th>
                    <Th>Other discounts</Th>
                    <Th>Free</Th>
                    <Th>List price</Th>
                    <Th on={sort === "volume"}>Discount</Th>
                    <Th on={sort === "share"}>% of list price</Th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((r, i) => {
                    const g = given(r);
                    return (
                      <tr key={r.location} style={{ borderTop: "1px solid var(--glass-border)" }}>
                        <td className="px-4 py-2.5 tabular text-glass-text-tertiary">{i + 1}</td>
                        <td className="px-4 py-2.5 font-semibold truncate" title={r.location}>
                          <Link href={linkFor(r.location, cur)} className="hover:underline" style={{ color: "var(--glass-text)" }}>
                            {r.location}
                          </Link>
                        </td>
                        <Num>{r.regs.toLocaleString()}</Num>
                        {/* Each kind as on the cards above: how many
                            registrations used it, and what it gave up. Other
                            leaves out the free registrations, which have their
                            own column. */}
                        <Kind n={r.returning_discounted} amount={r.returning_discount_total} />
                        <Kind n={r.referral_discounted} amount={r.referral_discount_total} />
                        <Kind n={Math.max(0, r.other_discounted - r.free)} amount={Math.max(0, r.other_discount_total - r.free_value)} />
                        <Kind n={r.free} amount={r.free_value} />
                        <Num>{money(listOf(r))}</Num>
                        <td className="px-4 py-2.5 text-right tabular whitespace-nowrap"
                          style={{ color: g.amount > 0 ? GOLD : "var(--glass-text-tertiary)", fontWeight: sort === "volume" ? 700 : 500 }}>
                          {g.amount > 0 ? `−${money(g.amount)}` : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular whitespace-nowrap"
                          style={{ color: "var(--glass-text)", fontWeight: sort === "share" ? 700 : 500 }}>
                          {pct(g.amount, listOf(r), 1)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Sticky header cell; the column the board is sorted by reads bright with an arrow.
function Th({ children, align = "right", on = false }: { children: React.ReactNode; align?: "left" | "right"; on?: boolean }) {
  return (
    <th className={`px-4 py-2.5 ${align === "left" ? "text-left" : "text-right"} font-bold whitespace-nowrap sticky top-0 z-[2] bg-glass-surface`}
      style={{ borderBottom: "1px solid var(--glass-border)", color: on ? "var(--glass-text)" : undefined }}>
      {children}{on ? " ↓" : ""}
    </th>
  );
}

// A kind of discount for one location: registrations, and dollars given up.
function Kind({ n, amount }: { n: number; amount: number }) {
  return (
    <td className="px-4 py-2.5 text-right tabular whitespace-nowrap align-middle">
      <div style={{ color: n > 0 ? "var(--glass-text)" : "var(--glass-text-tertiary)" }}>{n > 0 ? n.toLocaleString() : "—"}</div>
      {amount > 0.004 && <div className="text-[11px] text-glass-text-tertiary leading-snug">−{money(amount)}</div>}
    </td>
  );
}

function Num({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <td className="px-4 py-2.5 text-right tabular whitespace-nowrap align-middle" style={{ color: "var(--glass-text)" }}>
      <div>{children}</div>
      {sub && <div className="text-[11px] text-glass-text-tertiary leading-snug">{sub}</div>}
    </td>
  );
}
