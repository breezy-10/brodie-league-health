import Link from "next/link";
import { STICKY_TH_STYLE } from "../../dashboard/stickyTable";

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

// The page scrolls the window. Each card's title row sticks under the kit's
// header; the column headers stick under the title row and the totals row to
// the bottom of the window, but only on screens wide enough that the table
// doesn't scroll sideways (a sideways box would trap them; see stickyTable.ts).
// The title row is a fixed height so the headers know where to sit.
const BAR_H = 46;
const BOX = "overflow-x-auto min-[1440px]:overflow-visible";
const STICK_TH = "min-[1440px]:sticky min-[1440px]:top-[calc(var(--shell-top)_+_46px)] z-[4]";
const STICK_FOOT = "min-[1440px]:sticky min-[1440px]:bottom-0 z-[4]";
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number, of: number, digits = 0) => (of ? `${((100 * n) / of).toFixed(digits)}%` : "—");

// Column widths in percent, the same in every currency's card so they line up:
// rank, location, registrations, the four kinds (returning, referral, other,
// free), list price, discount, share.
const COLS: [string, number][] = [
  ["rank", 3], ["location", 14], ["regs", 8], ["returning", 11], ["referral", 11], ["other", 11],
  ["free", 11], ["list", 10], ["discount", 11], ["share", 10],
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
        const sum = (f: (r: LeaderRow) => number) => ranked.reduce((n, r) => n + f(r), 0);
        // Other leaves out the free registrations, as on the rows and the cards.
        const otherN = (r: LeaderRow) => Math.max(0, r.other_discounted - r.free);
        const otherAmt = (r: LeaderRow) => Math.max(0, r.other_discount_total - r.free_value);
        return (
          <div key={cur} className="rounded-2xl bg-glass-surface shadow-card">
            <div className="sticky top-[var(--shell-top)] z-[6] flex items-center gap-3 px-4 rounded-t-2xl bg-glass-surface"
              style={{ height: BAR_H, borderBottom: "1px solid var(--glass-border)" }}>
              <span className="text-sm font-bold whitespace-nowrap" style={{ color: "var(--glass-text)" }}>
                {COUNTRY[cur] ?? cur} · {ranked.length} location{ranked.length === 1 ? "" : "s"}
              </span>
              <span className="ml-auto min-w-0 truncate text-xs text-glass-text-tertiary tabular">
                {money(totalGiven)} {cur} given up · {pct(totalGiven, totalList, 1)} of {money(totalList)} list price
              </span>
            </div>
            <div className={`${BOX} rounded-b-2xl`}>
              <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: 1100, tableLayout: "fixed" }}>
                <colgroup>
                  {COLS.map(([k, w]) => <col key={k} style={{ width: `${w}%` }} />)}
                </colgroup>
                <thead>
                  <tr className="text-xs font-bold text-glass-text-tertiary">
                    <Th align="left">#</Th>
                    <Th align="left">Location</Th>
                    <Th>Registrations</Th>
                    <Th tight>Returning player</Th>
                    <Th tight>Referral</Th>
                    <Th tight>Other discounts</Th>
                    <Th tight>Free</Th>
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
                        <Kind n={r.returning_discounted} of={r.regs} amount={r.returning_discount_total} />
                        <Kind n={r.referral_discounted} of={r.regs} amount={r.referral_discount_total} />
                        <Kind n={otherN(r)} of={r.regs} amount={otherAmt(r)} />
                        <Kind n={r.free} of={r.regs} amount={r.free_value} />
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
                {/* The country's totals, held at the bottom of the window
                    while the card is in view, the way the header holds the top. */}
                <tfoot>
                  <tr className="font-bold">
                    <Foot align="left" />
                    <Foot align="left">Total</Foot>
                    <Foot>{sum((r) => r.regs).toLocaleString()}</Foot>
                    <FootKind n={sum((r) => r.returning_discounted)} of={sum((r) => r.regs)} amount={sum((r) => r.returning_discount_total)} />
                    <FootKind n={sum((r) => r.referral_discounted)} of={sum((r) => r.regs)} amount={sum((r) => r.referral_discount_total)} />
                    <FootKind n={sum(otherN)} of={sum((r) => r.regs)} amount={sum(otherAmt)} />
                    <FootKind n={sum((r) => r.free)} of={sum((r) => r.regs)} amount={sum((r) => r.free_value)} />
                    <Foot>{money(totalList)}</Foot>
                    <Foot gold>{totalGiven > 0 ? `−${money(totalGiven)}` : "—"}</Foot>
                    <Foot>{pct(totalGiven, totalList, 1)}</Foot>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Sticky header cell; the column the board is sorted by reads bright with an arrow.
function Th({ children, align = "right", on = false, tight = false }: { children: React.ReactNode; align?: "left" | "right"; on?: boolean; tight?: boolean }) {
  return (
    <th className={`${tight ? "px-2.5" : "px-4"} py-2.5 ${align === "left" ? "text-left" : "text-right"} font-bold whitespace-nowrap ${STICK_TH}`}
      style={{ ...STICKY_TH_STYLE, color: on ? "var(--glass-text)" : undefined }}>
      {children}{on ? " ↓" : ""}
    </th>
  );
}

// A cell of the totals row: sticky at the bottom of the window, with the
// dollars given up under a count where there are any.
function Foot({ children, align = "right", sub, note, gold = false, tight = false }: {
  children?: React.ReactNode; align?: "left" | "right"; sub?: number; note?: string; gold?: boolean; tight?: boolean;
}) {
  return (
    <td className={`${tight ? "px-2.5" : "px-4"} py-2.5 ${align === "left" ? "text-left" : "text-right"} tabular whitespace-nowrap align-middle ${STICK_FOOT} first:rounded-bl-2xl last:rounded-br-2xl`}
      style={{ ...STICKY_TH_STYLE, boxShadow: "inset 0 1px 0 var(--glass-border), 0 -10px 14px -10px rgba(0,0,0,0.55)", color: gold ? GOLD : "var(--glass-text)" }}>
      <div>{children}</div>
      {sub !== undefined && sub > 0.004 && (
        <div className="text-[11px] font-normal text-glass-text-tertiary leading-snug">−{money(sub)}</div>
      )}
      {note && <div className="text-[11px] font-normal text-glass-text-tertiary leading-snug">{note}</div>}
    </td>
  );
}

// A kind of discount for one location: how many of its registrations used it,
// that share, and the dollars it gave up.
const kindSub = (n: number, of: number, amount: number) =>
  [of ? pct(n, of) : null, amount > 0.004 ? `−${money(amount)}` : null].filter(Boolean).join(" · ");
function Kind({ n, of, amount }: { n: number; of: number; amount: number }) {
  return (
    <td className="px-2.5 py-2.5 text-right tabular whitespace-nowrap align-middle">
      <div style={{ color: n > 0 ? "var(--glass-text)" : "var(--glass-text-tertiary)" }}>
        {n.toLocaleString()} of {of.toLocaleString()}
      </div>
      <div className="text-[11px] text-glass-text-tertiary leading-snug">{kindSub(n, of, amount)}</div>
    </td>
  );
}

// The totals row's version of a kind cell.
function FootKind({ n, of, amount }: { n: number; of: number; amount: number }) {
  return (
    <Foot tight note={kindSub(n, of, amount)}>{n.toLocaleString()} of {of.toLocaleString()}</Foot>
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
