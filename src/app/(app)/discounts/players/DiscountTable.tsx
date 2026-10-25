"use client";

import { useState } from "react";
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import TeamRosterBlock, { StaffBadge, type RosterTeam } from "@/components/TeamRosterBlock";
import { normName } from "@/lib/names";
import { shortDiscount } from "@/lib/discount-names";

const GOLD = "var(--glass-gold)";
const COLS = 10;

export type DiscountRowData = {
  player: string; location: string; currency: string; type: string; team: string | null;
  list_price: number; discount: number; total_paid: number; free: boolean;
  codes: string; discount_names?: string; registered_on: string | null;
  season_team_id?: string | null; player_id?: string | null;
  // Everyone on the registration's team, discounted or not (absent from an
  // older feed).
  team_players?: number;
};


// Every registered team in scope, discounted or not (the Promo Tracker's
// teams=1), so team view can list the ones with no discount.
export type ScopeTeamData = {
  season_team_id: string; team: string; location: string; currency: string;
  team_players: number; list_total: number; paid_total: number; registered_on: string | null;
};

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

type Resolved =
  | { state: "loading" }
  | { state: "ok"; teamId: string; moved: boolean }
  | { state: "error"; message: string };
type Team = RosterTeam & { removed?: boolean };

// The team endpoint takes up to 80 teams a call (Metabase's row ceiling), and a
// few calls at once keep "expand all" on a Fall list to seconds, not minutes.
const CHUNK = 80;
const PARALLEL = 3;

const pairKey = (r: DiscountRowData) => `${r.season_team_id}|${r.player_id ?? ""}`;

// The discount drill-down table. Each registration with a team can open that
// team's roster and who has paid what. Rosters load when opened — one row, or
// every row at once from the toolbar — rather than with the page, since that
// meant thousands of payment lookups on a Fall list mostly read top-down.
// A team view row: every discounted registration on one team, added up.
type TeamUnit = {
  rep: DiscountRowData; team: string | null; location: string; currency: string;
  players: number; teamPlayers: number; free: number; list: number; discount: number; total: number;
  codes: string[]; names: string[]; first: string | null;
  // A team with no discounted registration, listed in its own section.
  none?: boolean;
};

export default function DiscountTable({
  rows, season, staff, ambassadors, teamView = false, unrostered: unrosteredProp, scopeTeams,
}: {
  rows: DiscountRowData[];
  season: string;
  staff: Record<string, string> | null;
  // Ops player ids of the season's ambassadors (captains of an ambassador
  // team), tagged beside Free and Staff.
  ambassadors?: string[] | null;
  // One row per team instead of per registration, opening the same roster.
  teamView?: boolean;
  // Team view's last block: free agents not on a team yet, discounted or not.
  unrostered?: DiscountRowData[];
  // Every team in scope; the ones with no discount get their own section.
  scopeTeams?: ScopeTeamData[];
}) {
  // Teams in scope, most given up first. A registration with no team has
  // nothing to group under; the footer of the page counts it in player view.
  const teamUnits: TeamUnit[] = (() => {
    if (!teamView) return [];
    const m = new Map<string, TeamUnit>();
    for (const r of rows) {
      if (!r.season_team_id) continue;
      const u = m.get(r.season_team_id) ?? {
        rep: r, team: r.team, location: r.location, currency: r.currency,
        players: 0, teamPlayers: 0, free: 0, list: 0, discount: 0, total: 0, codes: [], names: [], first: null,
      };
      u.players += 1;
      u.teamPlayers = Math.max(u.teamPlayers, r.team_players ?? 0);
      if (r.free) u.free += 1;
      u.list += r.list_price; u.discount += r.discount; u.total += r.total_paid;
      for (const c of r.codes.split(", ")) if (c && !u.codes.includes(c)) u.codes.push(c);
      const n = r.discount_names ? shortDiscount(r.discount_names) : "";
      if (n && !u.names.includes(n)) u.names.push(n);
      if (r.registered_on && (!u.first || r.registered_on < u.first)) u.first = r.registered_on;
      m.set(r.season_team_id, u);
    }
    const discounted = [...m.values()].sort((a, b) => b.discount - a.discount);
    // Teams with no discounted registration, by location then name. Their
    // row opens the roster like any other; no player is named, so the
    // roster lookup takes the team as it is now.
    const none: TeamUnit[] = (scopeTeams ?? [])
      .filter((t) => !m.has(t.season_team_id))
      .sort((a, b) => a.location.localeCompare(b.location) || a.team.localeCompare(b.team))
      .map((t) => ({
        rep: {
          player: "", location: t.location, currency: t.currency, type: "", team: t.team,
          list_price: t.list_total, discount: 0, total_paid: t.paid_total, free: false, codes: "",
          registered_on: t.registered_on, season_team_id: t.season_team_id, player_id: null, team_players: t.team_players,
        },
        team: t.team, location: t.location, currency: t.currency,
        players: 0, teamPlayers: t.team_players, free: 0, list: t.list_total, discount: 0, total: t.paid_total,
        codes: [], names: [], first: t.registered_on, none: true,
      }));
    return [...discounted, ...none];
  })();
  // Where the teams with no discount start in the list.
  const firstNone = teamUnits.findIndex((u) => u.none);
  const discountedCount = firstNone === -1 ? teamUnits.length : firstNone;
  // What each row opens: the registration itself, or the team's first one.
  const units: DiscountRowData[] = teamView ? teamUnits.map((u) => u.rep) : rows;
  // Team view lists these last: free agents waiting to be placed. The page
  // supplies every one, discounted or not; without it, the discounted ones.
  const unrostered = teamView ? (unrosteredProp ?? rows.filter((r) => !r.season_team_id)) : [];
  const [open, setOpen] = useState<Record<number, boolean>>({});
  // Keyed by team and player: two registrations on one team share a lookup,
  // but a merged team resolves per player, so the player is part of the key.
  const [resolved, setResolved] = useState<Record<string, Resolved>>({});
  const [teams, setTeams] = useState<Record<string, Team>>({});

  const openable = units.map((r) => !!r.season_team_id);

  async function load(list: DiscountRowData[]) {
    const want = new Map<string, DiscountRowData>();
    for (const r of list) {
      if (!r.season_team_id) continue;
      const k = pairKey(r);
      const cur = resolved[k];
      if (cur && cur.state !== "error") continue;
      want.set(k, r);
    }
    if (want.size === 0) return;
    const keys = [...want.keys()];
    setResolved((m) => {
      const next = { ...m };
      for (const k of keys) next[k] = { state: "loading" };
      return next;
    });

    const chunks: string[][] = [];
    for (let i = 0; i < keys.length; i += CHUNK) chunks.push(keys.slice(i, i + CHUNK));

    async function run(chunk: string[]) {
      try {
        const res = await fetch("/api/team-roster", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            season,
            pairs: chunk.map((k) => ({
              season_team_id: want.get(k)!.season_team_id,
              player_id: want.get(k)!.player_id ?? null,
            })),
          }),
        });
        const body = await res.json();
        if (!res.ok || !body.teams) throw new Error(body.error ?? `HTTP ${res.status}`);
        const got = body as {
          teams: Record<string, Team>;
          pairs: Record<string, { season_team_id: string; moved: boolean }>;
        };
        setTeams((t) => ({ ...t, ...got.teams }));
        setResolved((m) => {
          const next = { ...m };
          for (const k of chunk) {
            const hit = got.pairs[k];
            next[k] = hit
              ? { state: "ok", teamId: hit.season_team_id, moved: hit.moved }
              : { state: "error", message: "team not found" };
          }
          return next;
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setResolved((m) => {
          const next = { ...m };
          for (const k of chunk) next[k] = { state: "error", message };
          return next;
        });
      }
    }

    // A small pool: PARALLEL requests in flight until the chunks run out.
    let at = 0;
    await Promise.all(
      Array.from({ length: Math.min(PARALLEL, chunks.length) }, async () => {
        while (at < chunks.length) await run(chunks[at++]);
      }),
    );
  }

  function toggle(i: number, r: DiscountRowData) {
    const next = !open[i];
    setOpen((o) => ({ ...o, [i]: next }));
    if (next) void load([r]);
  }

  // Expand or collapse the rows of one card, leaving the other card alone.
  function setAll(idx: number[], to: boolean) {
    setOpen((o) => {
      const next = { ...o };
      for (const i of idx) next[i] = to;
      return next;
    });
    if (to) void load(idx.map((i) => units[i]));
  }

  const staffLabel = (name: string) => staff?.[normName(name)];
  const ambassadorIds = new Set(ambassadors ?? []);
  const isAmbassador = (r: DiscountRowData) => !!r.player_id && ambassadorIds.has(r.player_id);

  const renderUnit = (r: DiscountRowData, i: number) => {
              const canOpen = openable[i];
              const isOpen = canOpen && !!open[i];
              const got = canOpen ? resolved[pairKey(r)] : undefined;
              const team = got?.state === "ok" ? teams[got.teamId] : undefined;
              const sLabel = staffLabel(r.player);
              const u = teamView ? teamUnits[i] : null;
              const chevron = (
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
              );
              return [
                u ? (
                  <tr key={`row-${i}`} style={{ borderTop: "1px solid var(--glass-border)" }}>
                    <td className="px-4 py-2.5 font-semibold whitespace-nowrap" style={{ color: "var(--glass-text)" }}>
                      <span className="flex items-center gap-1.5">
                        {chevron}
                        <span className="min-w-0 truncate" title={u.team ?? ""}>{u.team ?? "—"}</span>
                        {u.free > 0 && (
                          <span className="shrink-0 ml-0.5 text-[11px] font-bold px-1.5 py-0.5 rounded"
                            style={{ background: "var(--glass-gold-light, var(--fill-3))", color: GOLD }}>
                            {u.free > 1 ? `${u.free} free` : "Free"}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 truncate" style={{ color: "var(--glass-text)" }} title={u.location}>{u.location}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap align-middle">
                      {u.teamPlayers > 0 ? (() => {
                        // A discounted player who has since left the roster
                        // still counts, so the share never passes 100%.
                        const of = Math.max(u.teamPlayers, u.players);
                        return (
                          <>
                            <div className="tabular" style={{ color: "var(--glass-text)" }}>
                              {u.players} of {of} player{of === 1 ? "" : "s"}
                            </div>
                            <div className="text-[11px] text-glass-text-tertiary leading-snug tabular">
                              {Math.round((100 * u.players) / of)}%
                            </div>
                          </>
                        );
                      })() : (
                        <span className="text-glass-text-tertiary">{u.players} player{u.players === 1 ? "" : "s"}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[12px] max-w-[200px] truncate text-glass-text-tertiary" title={u.codes.join(", ")}>
                      {u.codes.join(", ") || "—"}
                    </td>
                    <td className="px-4 py-2.5 max-w-[240px] truncate" style={{ color: "var(--glass-text-secondary)" }}
                      title={u.names.join(", ")}>
                      {u.names.join(", ") || "—"}
                    </td>
                    <Td>{money(u.list)}</Td>
                    <td className="px-4 py-2.5 text-right tabular whitespace-nowrap align-middle">
                      {u.discount > 0 ? (
                        <>
                          <div style={{ color: GOLD, fontWeight: 700 }}>−{money(u.discount)}</div>
                          <div className="text-[11px] text-glass-text-tertiary leading-snug">
                            {u.list ? `${Math.round((100 * u.discount) / u.list)}%` : "—"}
                          </div>
                        </>
                      ) : (
                        <span className="text-glass-text-tertiary">—</span>
                      )}
                    </td>
                    <Td>{money(u.total)}</Td>
                    {/* The team's first discounted registration. */}
                    <Td>{day(u.first)}</Td>
                  </tr>
                ) : (
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
                        // No team to open; the gap keeps names aligned.
                        <span className="shrink-0 -ml-1 inline-block" style={{ width: 18 }} aria-hidden />
                      )}
                      <span>{r.player}</span>
                      {r.free && (
                        <span className="ml-0.5 text-[11px] font-bold px-1.5 py-0.5 rounded"
                          style={{ background: "var(--glass-gold-light, var(--fill-3))", color: GOLD }}>Free</span>
                      )}
                      {sLabel && <StaffBadge label={sLabel} />}
                      {isAmbassador(r) && <AmbassadorBadge />}
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
                  {/* The share of list price says what a discount actually was —
                      $66 is a fifth off in Canada and a quarter in the US, and
                      the dollar figure alone hides that. */}
                  <td className="px-4 py-2.5 text-right tabular whitespace-nowrap align-middle">
                    <div style={{ color: GOLD, fontWeight: 700 }}>−{money(r.discount)}</div>
                    <div className="text-[11px] text-glass-text-tertiary leading-snug">
                      {r.list_price ? `${Math.round((100 * r.discount) / r.list_price)}%` : "—"}
                    </div>
                  </td>
                  <Td>{money(r.total_paid)}</Td>
                  <Td>{day(r.registered_on)}</Td>
                </tr>
                ),
                isOpen && (
                  <tr key={`detail-${i}`} style={{ background: "var(--glass-surface-hover)" }}>
                    <td colSpan={teamView ? COLS - 1 : COLS} className="px-4 py-3">
                      {!got || got.state === "loading" ? (
                        <span className="inline-flex items-center gap-2 text-xs text-glass-text-tertiary">
                          <span className="inline-block w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
                          Loading roster…
                        </span>
                      ) : got.state === "error" || !team ? (
                        <span className="text-xs italic text-glass-text-tertiary">
                          Couldn&apos;t load this roster{got.state === "error" ? ` (${got.message})` : ""}.{" "}
                          <button type="button" className="underline" onClick={() => void load([r])}>Try again</button>
                        </span>
                      ) : (
                        <TeamRosterBlock
                          team={team}
                          staff={staff ?? undefined}
                          note={got.moved
                            ? `Registered on ${r.team ?? "a team"}, which was merged — showing the team they're on now.`
                            : team.removed
                              ? "This team has since been removed from the league."
                              : undefined}
                        />
                      )}
                    </td>
                  </tr>
                ),
              ];
            };

  // One card: a toolbar (the section's name on the left, Expand all on the
  // right) over a table that scrolls in its own box under a sticky header.
  // Team view has two, the teams with a discount and the teams with none;
  // player view has one. Rows keep their index in units, so each card's
  // toggle opens and closes only its own rows.
  const card = (key: string, title: string | null, from: number, to: number, extra?: React.ReactNode) => {
    const idx: number[] = [];
    for (let i = from; i < to; i++) if (openable[i]) idx.push(i);
    // Every openable row already open: the toggle then offers Collapse all.
    const allOpen = idx.length > 0 && idx.every((i) => open[i]);
    const loading = units.slice(from, to).some((r) => r.season_team_id && resolved[pairKey(r)]?.state === "loading");
    return (
      <div key={key} className="rounded-2xl bg-glass-surface overflow-hidden shadow-card">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5"
          style={{ borderBottom: "1px solid var(--glass-border)" }}>
          {title && <span className="text-sm font-bold" style={{ color: "var(--glass-text)" }}>{title}</span>}
          {loading && (
            <span className="inline-flex items-center gap-2 text-xs text-glass-text-tertiary">
              <span className="inline-block w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
              Loading rosters…
            </span>
          )}
          {/* One toggle rather than a disabled pair: the label always names
              the action the click performs, so there is nothing dimmed to
              decode. Matches the check-in panel in overdue-payments. */}
          <button
            type="button"
            onClick={() => setAll(idx, !allOpen)}
            disabled={idx.length === 0}
            className={`${TOOL_BTN} ml-auto`}
          >
            {allOpen ? <ChevronsDownUp size={13} /> : <ChevronsUpDown size={13} />}
            {allOpen ? "Collapse all" : "Expand all"}
          </button>
        </div>
        {/* The table scrolls inside this box, not the window, so its header row
            stays at the box's top (top-0) however far down the list you are, as
            on the Ambassadors table. The box is as tall as the window allows
            under the kit's header and this card's toolbar. */}
        <div className="overflow-x-auto" style={{ maxHeight: "max(460px, calc(100vh - var(--shell-top) - 120px))" }}>
          <table className="w-full text-sm"
            style={{ borderCollapse: "collapse", minWidth: 1120, ...(teamView ? { tableLayout: "fixed" as const } : {}) }}>
            {/* Team view: the same fixed widths in both cards, so Discounts and
                No discounts line up column for column (as on Events). */}
            {teamView && (
              <colgroup>
                {TEAM_COLS.map(([k, w]) => <col key={k} style={{ width: `${w}%` }} />)}
              </colgroup>
            )}
            <thead>
              {teamView ? (
                <tr className="text-xs font-bold text-glass-text-tertiary">
                  <Th align="left">Team</Th>
                  <Th align="left">Location</Th>
                  {/* How many on the team carried a discount, out of everyone
                      on its roster, and that share. */}
                  <Th align="left">Discounted</Th>
                  <Th align="left">Code</Th>
                  <Th align="left">Discount type</Th>
                  <Th>List price</Th>
                  <Th>Discount</Th>
                  <Th>Total price</Th>
                  <Th>Registered</Th>
                </tr>
              ) : (
              <tr className="text-xs font-bold text-glass-text-tertiary">
                <Th align="left">Player</Th>
                <Th align="left">Location</Th>
                {/* Captain or player — the kind of registration, not the kind of
                    discount, which the Code column beside it names. */}
                <Th align="left">Reg type</Th>
                <Th align="left">Team</Th>
                <Th align="left">Code</Th>
                {/* What the code is for. The ops DB's own discount "type" is
                    'coupon' on all but a handful of rows system-wide, so the
                    discount's name is the field that actually separates an
                    ambassador comp from a referral from a returning player. */}
                <Th align="left">Discount type</Th>
                <Th>List price</Th>
                <Th>Discount</Th>
                <Th>Total price</Th>
                <Th>Registered</Th>
              </tr>
              )}
            </thead>
            <tbody>
              {units.slice(from, to).map((r, j) => renderUnit(r, from + j))}
              {extra}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const teamCount = (n: number) => `${n} team${n === 1 ? "" : "s"}`;
  // Team view's last block, under the discounted teams: free agents not on a team yet.
  const freeAgents = unrostered.length > 0 && (
    <>
      <tr style={{ borderTop: "1px solid var(--glass-border)", background: "var(--glass-surface-hover)" }}>
        <td colSpan={COLS - 1} className="px-4 py-2 text-xs font-bold text-glass-text-tertiary">
          Not on a team yet · {unrostered.length} free agent{unrostered.length === 1 ? "" : "s"}
        </td>
      </tr>
      {unrostered.map((r, i) => {
        const sLabel = staffLabel(r.player);
        return (
          <tr key={`fa-${i}`} style={{ borderTop: "1px solid var(--glass-border)" }}>
            <td className="px-4 py-2.5 font-semibold whitespace-nowrap" style={{ color: "var(--glass-text)" }}>
              <span className="flex items-center gap-1.5">
                {/* No roster to open; the gap keeps names aligned with the teams. */}
                <span className="shrink-0 -ml-1 inline-block" style={{ width: 18 }} aria-hidden />
                <span>{r.player}</span>
                {r.free && (
                  <span className="ml-0.5 text-[11px] font-bold px-1.5 py-0.5 rounded"
                    style={{ background: "var(--glass-gold-light, var(--fill-3))", color: GOLD }}>Free</span>
                )}
                {sLabel && <StaffBadge label={sLabel} />}
                {isAmbassador(r) && <AmbassadorBadge />}
              </span>
            </td>
            <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: "var(--glass-text)" }}>{r.location}</td>
            <td className="px-4 py-2.5 whitespace-nowrap text-glass-text-tertiary">{TYPE_LABEL[r.type] ?? r.type}</td>
            <td className="px-4 py-2.5 font-mono text-[12px] max-w-[200px] truncate text-glass-text-tertiary" title={r.codes}>{r.codes}</td>
            <td className="px-4 py-2.5 max-w-[240px] truncate" style={{ color: "var(--glass-text-secondary)" }}
              title={r.discount_names ?? ""}>
              {r.discount_names ? shortDiscount(r.discount_names) : "—"}
            </td>
            <Td>{money(r.list_price)}</Td>
            <td className="px-4 py-2.5 text-right tabular whitespace-nowrap align-middle">
              {r.discount > 0 ? (
                <>
                  <div style={{ color: GOLD, fontWeight: 700 }}>−{money(r.discount)}</div>
                  <div className="text-[11px] text-glass-text-tertiary leading-snug">
                    {r.list_price ? `${Math.round((100 * r.discount) / r.list_price)}%` : "—"}
                  </div>
                </>
              ) : (
                // Full price: nothing came off.
                <span className="text-glass-text-tertiary">—</span>
              )}
            </td>
            <Td>{money(r.total_paid)}</Td>
            <Td>{day(r.registered_on)}</Td>
          </tr>
        );
      })}
    </>
  );

  if (!teamView) return card("players", null, 0, units.length, freeAgents);
  return (
    <div className="space-y-4">
      {(discountedCount > 0 || unrostered.length > 0)
        && card("discounts", `Discounts · ${teamCount(discountedCount)}`, 0, discountedCount, freeAgents)}
      {firstNone !== -1
        && card("none", `No discounts · ${teamCount(units.length - discountedCount)}`, discountedCount, units.length)}
    </div>
  );
}

// Team view's column widths in percent, shared by both cards: team, location,
// discounted, code, discount type, list price, discount, total, registered.
const TEAM_COLS: [string, number][] = [
  ["team", 17], ["location", 10], ["discounted", 11], ["code", 12], ["type", 15],
  ["list", 8], ["discount", 8], ["total", 10], ["registered", 9],
];

const TOOL_BTN =
  "inline-flex items-center gap-1.5 rounded-md border border-glass-border px-2.5 py-1 text-[11px] font-semibold "
  + "text-glass-text-tertiary hover:text-glass-text hover:border-glass-gold hover:bg-glass-surface-hover transition "
  + "disabled:opacity-40 disabled:pointer-events-none";

// Header cells stick to the top of the table's scroll box.
function Th({ children, align = "right" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th className={`px-4 py-2.5 ${align === "left" ? "text-left" : "text-right"} font-bold whitespace-nowrap sticky top-0 z-[2] bg-glass-surface`}
      style={{ borderBottom: "1px solid var(--glass-border)" }}>
      {children}
    </th>
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

// Beside Free and Staff, in the same size: the player captains an ambassador
// team this season.
function AmbassadorBadge() {
  return (
    <span className="ml-1.5 text-[11px] font-bold px-1.5 py-0.5 rounded align-middle cursor-help"
      style={{ background: "var(--fill-3)", color: "var(--glass-text)" }}
      title="Captains an ambassador team this season">
      Ambassador
    </span>
  );
}
