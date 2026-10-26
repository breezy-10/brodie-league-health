"use client";

import { useState } from "react";
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { STICKY_TH_STYLE, stickyTh, tableScrollBox } from "../dashboard/stickyTable";
import { money, pct } from "./waitlist-format";

export type WaitlistRow = {
  market: string;
  status: string;
  launch: string | null;
  launch_start: string | null;
  opened_on: string | null;
  signed_up: number;
  started: number;
  cancelled: number;
  new_to_brodie: number;
  deposits: number;
  currency: string | null;
  latest_signup: string | null;
};

// Someone who signed up for a market's waitlist or started and didn't pay (the
// promo feed's ?view=people).
export type WaitlistPerson = {
  market: string;
  name: string;
  state: "signed" | "started";
  is_new: boolean;
  deposit: number;
  currency: string | null;
  on: string | null; // "2026-10-12", Toronto date
};

// "2026-10-12" read as a date, not through Date in the viewer's zone.
function shortDate(d: string | null): string {
  if (!d) return "—";
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, day)));
}

const CHIP = "inline-block text-[11px] font-semibold rounded-md px-1.5 py-0.5 whitespace-nowrap";
const STATUS: Record<string, { label: string; style: React.CSSProperties }> = {
  open: { label: "Open", style: { color: "var(--green)", background: "var(--green-tint)" } },
  draft: { label: "Draft", style: { color: "var(--glass-text-secondary)", background: "var(--fill-3)" } },
  closed: { label: "Closed", style: { color: "var(--glass-text-secondary)", background: "var(--fill-3)" } },
};
const TOOL_BTN =
  "inline-flex items-center gap-1.5 rounded-md border border-glass-border px-2.5 py-1 text-[11px] font-semibold "
  + "text-glass-text-tertiary hover:text-glass-text hover:border-glass-gold hover:bg-glass-surface-hover transition "
  + "disabled:opacity-40 disabled:pointer-events-none";
const MIN_WIDTH = 900;

// The markets table. Each market opens to its people, one line each under the
// columns their details belong to; the toolbar's toggle opens or closes them
// all, as on Events and Discounts.
export default function WaitlistTable({ markets, people, totals }: {
  markets: WaitlistRow[];
  people: Record<string, WaitlistPerson[]>;
  totals: { signedUp: number; started: number; newToBrodie: number; deposits: [string, number][] };
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const allOpen = markets.length > 0 && markets.every((r) => open[r.market]);
  const setAll = (to: boolean) => setOpen(Object.fromEntries(markets.map((r) => [r.market, to])));

  return (
    <div className="rounded-2xl bg-glass-surface shadow-card">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5" style={{ borderBottom: "1px solid var(--glass-border)" }}>
        <span className="text-sm font-bold" style={{ color: "var(--glass-text)" }}>Markets</span>
        <span className="text-xs text-glass-text-tertiary">{markets.length.toLocaleString()}</span>
        <button type="button" onClick={() => setAll(!allOpen)} className={`${TOOL_BTN} ml-auto`}>
          {allOpen ? <ChevronsDownUp size={13} /> : <ChevronsUpDown size={13} />}
          {allOpen ? "Collapse all" : "Expand all"}
        </button>
      </div>
      <div className={tableScrollBox(MIN_WIDTH)}>
        <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: MIN_WIDTH }}>
          <thead>
            <tr className="text-xs font-bold text-glass-text-tertiary">
              <Th align="left">Market</Th>
              <Th align="left">Launch</Th>
              <Th align="left">Status</Th>
              <Th>Signed up</Th>
              <Th>Started, not paid</Th>
              <Th>New to Brodie</Th>
              <Th>Deposits</Th>
              <Th>Latest sign-up</Th>
            </tr>
          </thead>
          <tbody>
            {markets.flatMap((r) => {
              const quiet = r.signed_up === 0 && r.started === 0;
              const st = STATUS[r.status] ?? { label: r.status, style: STATUS.draft.style };
              const isOpen = !!open[r.market];
              const ppl = people[r.market] ?? [];
              const row = (
                <tr key={r.market} style={{ borderTop: "1px solid var(--glass-border)" }}>
                  <td className="px-4 py-2.5 font-semibold"
                    style={{ color: quiet ? "var(--glass-text-secondary)" : "var(--glass-text)" }}>
                    <span className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setOpen((o) => ({ ...o, [r.market]: !o[r.market] }))}
                        aria-expanded={isOpen}
                        aria-label={`${isOpen ? "Hide" : "Show"} who's on the ${r.market} waitlist`}
                        className="shrink-0 -ml-1 px-1 py-0.5 rounded hover:bg-glass-surface-hover focus-visible:outline focus-visible:outline-2"
                        style={{ color: "var(--glass-text-tertiary)" }}
                      >
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden
                          className="transition-transform duration-150"
                          style={{ transform: isOpen ? "rotate(180deg)" : undefined }}>
                          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5"
                            strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                      {r.market}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-glass-text-secondary whitespace-nowrap">{r.launch ?? "—"}</td>
                  <td className="px-4 py-2.5"><span className={CHIP} style={st.style}>{st.label}</span></td>
                  <td className="px-4 py-2.5 text-right tabular font-semibold"
                    style={{ color: r.signed_up ? "var(--glass-text)" : "var(--glass-text-tertiary)" }}>
                    {r.signed_up}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular"
                    style={{ color: r.started ? "var(--glass-text)" : "var(--glass-text-tertiary)" }}>
                    {r.started}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular whitespace-nowrap">
                    {r.signed_up ? (
                      <>
                        <div style={{ color: "var(--glass-text)" }}>{pct(r.new_to_brodie, r.signed_up)}</div>
                        <div className="text-[11px] text-glass-text-tertiary">{r.new_to_brodie} of {r.signed_up}</div>
                      </>
                    ) : <span className="text-glass-text-tertiary">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular whitespace-nowrap"
                    style={{ color: r.deposits ? "var(--glass-text)" : "var(--glass-text-tertiary)" }}>
                    {r.deposits && r.currency ? money(r.deposits, r.currency) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular whitespace-nowrap text-glass-text-secondary">
                    {shortDate(r.latest_signup)}
                  </td>
                </tr>
              );
              if (!isOpen) return [row];
              if (!ppl.length) {
                return [row, (
                  <tr key={`${r.market}-none`} style={{ background: "var(--glass-surface-hover)" }}>
                    <td colSpan={8} className="px-4 py-2.5 pl-10 text-xs italic text-glass-text-tertiary">
                      Nobody has signed up or started yet.
                    </td>
                  </tr>
                )];
              }
              // Signed up first, then started; newest first within each (the feed's order).
              return [row, ...ppl.map((p, i) => (
                <tr key={`${r.market}-${i}`} style={{ background: "var(--glass-surface-hover)" }}>
                  <td colSpan={3} className="px-4 py-1.5 pl-10" style={{ color: "var(--glass-text)" }}>{p.name}</td>
                  <td className="px-4 py-1.5 text-right text-xs whitespace-nowrap text-glass-text-secondary">
                    {p.state === "signed" ? "Signed up" : null}
                  </td>
                  <td className="px-4 py-1.5 text-right text-xs whitespace-nowrap text-glass-text-tertiary">
                    {p.state === "started" ? "Started" : null}
                  </td>
                  <td className="px-4 py-1.5 text-right">
                    {p.is_new && <span className={CHIP} style={{ color: "var(--amber-ink)", background: "var(--amber-tint)" }}>New</span>}
                  </td>
                  <td className="px-4 py-1.5 text-right tabular text-xs whitespace-nowrap" style={{ color: "var(--glass-text)" }}>
                    {p.state === "signed" && p.currency ? money(p.deposit, p.currency) : null}
                  </td>
                  <td className="px-4 py-1.5 text-right tabular text-xs whitespace-nowrap text-glass-text-secondary">
                    {shortDate(p.on)}
                  </td>
                </tr>
              ))];
            })}
            {markets.length > 1 && (
              <tr style={{ borderTop: "2px solid var(--glass-border-light)" }}>
                <td className="px-4 py-3 font-bold" style={{ color: "var(--glass-text)" }} colSpan={3}>All markets</td>
                <td className="px-4 py-3 text-right tabular font-bold" style={{ color: "var(--glass-text)" }}>{totals.signedUp}</td>
                <td className="px-4 py-3 text-right tabular font-bold" style={{ color: "var(--glass-text)" }}>{totals.started}</td>
                <td className="px-4 py-3 text-right tabular font-bold whitespace-nowrap" style={{ color: "var(--glass-text)" }}>
                  {pct(totals.newToBrodie, totals.signedUp)}
                </td>
                <td className="px-4 py-3 text-right tabular font-bold whitespace-nowrap" style={{ color: "var(--glass-text)" }}>
                  {totals.deposits.length ? totals.deposits.map(([c, n]) => money(n, c)).join(" · ") : "—"}
                </td>
                <td />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children, align = "right" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th className={`px-4 py-2.5 ${align === "left" ? "text-left" : "text-right"} font-bold ${stickyTh(MIN_WIDTH)}`} style={STICKY_TH_STYLE}>
      {children}
    </th>
  );
}
