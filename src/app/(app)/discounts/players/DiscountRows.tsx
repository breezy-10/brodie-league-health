"use client";

import { useState } from "react";
import TeamRosterBlock, { type RosterTeam } from "@/components/TeamRosterBlock";

const GOLD = "var(--glass-gold)";
const COLS = 10;

export type DiscountRowData = {
  player: string; location: string; currency: string; type: string; team: string | null;
  list_price: number; discount: number; total_paid: number; free: boolean;
  codes: string; discount_names?: string; registered_on: string | null;
  season_team_id?: string | null; player_id?: string | null;
};

type RosterResult = RosterTeam & { moved?: boolean; removed?: boolean };
type Loaded =
  | { state: "loading" }
  | { state: "ok"; data: RosterResult }
  | { state: "error"; message: string };

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// Discount names are written with the season in front — "Coldest Winter 2027
// Returning Player Discount" — which is the half you already know from the
// season filter, and the half that pushes the part you don't off the end of the
// column. The full name stays on hover.
const SEASON_PREFIX =
  /^(?:the\s+)?(?:coldest\s+winter|brodie\s+summer|bracket\s+season|slasher\s+season|winter|summer|spring|fall)\s*'?\d{0,4}\s+/i;
const shortDiscount = (name: string) =>
  name.split(", ").map((n) => n.replace(SEASON_PREFIX, "").trim() || n).join(", ");
const TYPE_LABEL: Record<string, string> = { captain: "Captain", join_team: "Join team", free_agent: "Free agent" };
// Pinned to Eastern time. This renders on the server (UTC) and again in the
// browser, and without a fixed zone the two disagree for anything registered
// after 8pm Eastern — a hydration mismatch, which makes React rebuild the page
// and wipes the theme off <html>. fin_invoices.date is timestamptz, so the
// instant is exact and only the display zone needs choosing.
const day = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "America/Toronto" })
    : "—";

// The table body of the discount drill-down. Each registration with a team can
// open that team's roster and who has paid what; rosters are fetched when a row
// is first opened, since loading every team with the page meant thousands of
// payment lookups on a Fall list nobody expands most of.
export default function DiscountRows({ rows, season }: { rows: DiscountRowData[]; season: string }) {
  const [open, setOpen] = useState<Record<number, boolean>>({});
  // Keyed by team and player: two registrations on one team share a fetch,
  // but a merged team resolves per player, so the player is part of the key.
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({});

  const keyOf = (r: DiscountRowData) => `${r.season_team_id}|${r.player_id ?? ""}`;

  async function load(r: DiscountRowData) {
    const k = keyOf(r);
    if (loaded[k] && loaded[k].state !== "error") return;
    setLoaded((m) => ({ ...m, [k]: { state: "loading" } }));
    try {
      const p = new URLSearchParams({ season, season_team_id: r.season_team_id! });
      if (r.player_id) p.set("player_id", r.player_id);
      const res = await fetch(`/api/team-roster?${p}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok || !body.roster) throw new Error(body.error ?? `HTTP ${res.status}`);
      setLoaded((m) => ({ ...m, [k]: { state: "ok", data: body as RosterResult } }));
    } catch (e) {
      setLoaded((m) => ({ ...m, [k]: { state: "error", message: e instanceof Error ? e.message : String(e) } }));
    }
  }

  function toggle(i: number, r: DiscountRowData) {
    const next = !open[i];
    setOpen((o) => ({ ...o, [i]: next }));
    if (next) void load(r);
  }

  return (
    <tbody>
      {rows.map((r, i) => {
        const canOpen = !!r.season_team_id;
        const isOpen = canOpen && !!open[i];
        const got = canOpen ? loaded[keyOf(r)] : undefined;
        return [
          <tr key={`row-${i}`} style={{ borderTop: "1px solid var(--glass-border)" }}>
            <td className="px-4 py-2.5 font-semibold whitespace-nowrap" style={{ color: "var(--glass-text)" }}>
              <span className="flex items-center gap-1.5">
                {canOpen ? (
                  <button
                    type="button"
                    onClick={() => toggle(i, r)}
                    aria-expanded={isOpen}
                    aria-label={`${isOpen ? "Hide" : "Show"} ${r.team ?? "team"} roster`}
                    className="shrink-0 -ml-1 px-1 py-0.5 rounded hover:bg-glass-surface-hover focus-visible:outline focus-visible:outline-2"
                    style={{ color: "var(--glass-text-tertiary)", outlineColor: GOLD }}
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden
                      className="transition-transform duration-150"
                      style={{ transform: isOpen ? "rotate(180deg)" : undefined }}>
                      <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5"
                        strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                ) : (
                  // Free agents have no team to open; the gap keeps names aligned.
                  <span className="shrink-0 -ml-1 inline-block" style={{ width: 18 }} aria-hidden />
                )}
                <span>{r.player}</span>
                {r.free && (
                  <span className="ml-0.5 text-[9px] uppercase tracking-[0.16em] font-bold px-1.5 py-0.5 rounded"
                    style={{ background: "var(--glass-gold-light, rgba(255,184,0,0.16))", color: GOLD }}>Free</span>
                )}
              </span>
            </td>
            <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: "var(--glass-text)" }}>{r.location}</td>
            <td className="px-4 py-2.5 whitespace-nowrap text-glass-text-tertiary">{TYPE_LABEL[r.type] ?? r.type}</td>
            <td className="px-4 py-2.5 max-w-[220px] truncate" style={{ color: "var(--glass-text)" }} title={r.team ?? ""}>
              {r.team ?? "—"}
            </td>
            <td className="px-4 py-2.5 font-mono text-[12px] whitespace-nowrap text-glass-text-tertiary" title={r.codes}>
              {r.codes}
            </td>
            <td className="px-4 py-2.5 max-w-[240px] truncate" style={{ color: "var(--glass-text-secondary)" }}
              title={r.discount_names ?? ""}>
              {r.discount_names ? shortDiscount(r.discount_names) : "—"}
            </td>
            <Td>{money(r.list_price)}</Td>
            {/* The share of list price says what a discount actually was — $66
                is a fifth off in Canada and a quarter in the US, and the dollar
                figure alone hides that. */}
            <td className="px-4 py-2.5 text-right tabular whitespace-nowrap align-middle">
              <div style={{ color: GOLD, fontWeight: 700 }}>−{money(r.discount)}</div>
              <div className="text-[11px] text-glass-text-tertiary leading-snug">
                {r.list_price ? `${Math.round((100 * r.discount) / r.list_price)}%` : "—"}
              </div>
            </td>
            <Td>{money(r.total_paid)}</Td>
            <Td>{day(r.registered_on)}</Td>
          </tr>,
          isOpen && (
            <tr key={`detail-${i}`} style={{ background: "var(--glass-surface-hover)" }}>
              <td colSpan={COLS} className="px-4 py-3">
                {!got || got.state === "loading" ? (
                  <span className="inline-flex items-center gap-2 text-xs text-glass-text-tertiary">
                    <span className="inline-block w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
                    Loading roster…
                  </span>
                ) : got.state === "error" ? (
                  <span className="text-xs italic text-glass-text-tertiary">
                    Couldn&apos;t load this roster ({got.message}).{" "}
                    <button type="button" className="underline" onClick={() => void load(r)}>Try again</button>
                  </span>
                ) : (
                  <TeamRosterBlock
                    team={got.data}
                    note={got.data.moved
                      ? `Registered on ${r.team ?? "a team"}, which was merged — showing the team they're on now.`
                      : got.data.removed
                        ? "This team has since been removed from the league."
                        : undefined}
                  />
                )}
              </td>
            </tr>
          ),
        ];
      })}
    </tbody>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td className="px-4 py-2.5 text-right tabular whitespace-nowrap"
      style={{ color: "var(--glass-text)", fontWeight: 500 }}>
      {children}
    </td>
  );
}
