"use client";

import Link from "next/link";
import { useState } from "react";

const GOLD = "var(--glass-gold)";
const THIN = "var(--glass-yellow)";

export type TableRosterEntry = {
  player: string;
  is_captain: boolean;
  paid: number;
  total: number;
  currency: string | null;
  paid_ok: boolean;
  no_registration: boolean;
};

export type CaptainTeam = {
  team: string;
  location: string;
  day: string | null;
  division: string | null;
  players: number;
  roster: TableRosterEntry[];
};

export type CaptainRow = {
  key: string;
  id: string | null;
  name: string;
  teams: number;
  fullRoster: number | null;
  teammates: number | null;
  avg: number | null;
  paid: number | null;
  avgPaid: number | null;
};

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const dayRank = (d: string | null) => {
  const i = d ? DAYS.indexOf(d) : -1;
  return i === -1 ? 99 : i;
};

function money(x: TableRosterEntry) {
  if (x.no_registration) return "no reg";
  const cur = x.currency ? ` ${x.currency.toUpperCase()}` : "";
  return `$${Math.round(x.paid)} / $${Math.round(x.total)}${cur}`;
}

export default function AmbassadorTable({
  rows,
  teamsByKey,
  season,
  hasFullRoster,
  hasTeammates,
  hasPaid,
}: {
  rows: CaptainRow[];
  teamsByKey: Record<string, CaptainTeam[]>;
  season: string;
  hasFullRoster: boolean;
  hasTeammates: boolean;
  hasPaid: boolean;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const colCount = 3 + (hasFullRoster ? 1 : 0) + (hasTeammates ? 1 : 0) + (hasPaid ? 2 : 0);

  return (
    <div className="overflow-x-auto" style={{ maxHeight: 460 }}>
      <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: 420 }}>
        <thead>
          <tr className="text-[11px] sm:text-[10px] uppercase tracking-[0.16em] font-bold text-glass-text-tertiary">
            <th className="px-4 py-2.5 text-left font-bold sticky top-0 bg-glass-surface"
              style={{ borderBottom: "1px solid var(--glass-border)" }}>Ambassador</th>
            <th className="px-4 py-2.5 text-right font-bold sticky top-0 bg-glass-surface"
              style={{ borderBottom: "1px solid var(--glass-border)" }}>Teams</th>
            {hasFullRoster && (
              <th className="px-4 py-2.5 text-right font-bold sticky top-0 bg-glass-surface"
                style={{ borderBottom: "1px solid var(--glass-border)" }}>Teams with 7+</th>
            )}
            {hasTeammates && (
              <th className="px-4 py-2.5 text-right font-bold sticky top-0 bg-glass-surface"
                style={{ borderBottom: "1px solid var(--glass-border)" }}>Teammates</th>
            )}
            <th className="px-4 py-2.5 text-right font-bold sticky top-0 bg-glass-surface"
              style={{ borderBottom: "1px solid var(--glass-border)" }}>Avg teammates per team</th>
            {hasPaid && (
              <>
                <th className="px-4 py-2.5 text-right font-bold sticky top-0 bg-glass-surface"
                  style={{ borderBottom: "1px solid var(--glass-border)" }}>Paid teammates</th>
                <th className="px-4 py-2.5 text-right font-bold sticky top-0 bg-glass-surface"
                  style={{ borderBottom: "1px solid var(--glass-border)" }}>Avg paid per team</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const teams = [...(teamsByKey[c.key] ?? [])].sort(
              (a, b) =>
                a.location.localeCompare(b.location) ||
                dayRank(a.day) - dayRank(b.day) ||
                a.team.localeCompare(b.team),
            );
            const isOpen = !!open[c.key];
            return (
              <Row key={c.key} c={c} teams={teams} isOpen={isOpen} colCount={colCount} season={season}
                hasFullRoster={hasFullRoster} hasTeammates={hasTeammates} hasPaid={hasPaid}
                toggle={() => setOpen((o) => ({ ...o, [c.key]: !o[c.key] }))} />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Row({
  c, teams, isOpen, colCount, season, hasFullRoster, hasTeammates, hasPaid, toggle,
}: {
  c: CaptainRow;
  teams: CaptainTeam[];
  isOpen: boolean;
  colCount: number;
  season: string;
  hasFullRoster: boolean;
  hasTeammates: boolean;
  hasPaid: boolean;
  toggle: () => void;
}) {
  return (
    <>
      <tr style={{ borderTop: "1px solid var(--glass-border)" }}>
        <td className="px-4 py-2.5">
          <span className="flex items-baseline gap-1.5">
            {teams.length > 0 && (
              <button
                type="button"
                onClick={toggle}
                aria-expanded={isOpen}
                aria-label={`${isOpen ? "Hide" : "Show"} ${c.name}'s teams`}
                className="shrink-0 -ml-1 px-1 py-0.5 rounded hover:bg-glass-surface-hover focus-visible:outline focus-visible:outline-2"
                style={{ color: "var(--glass-text-tertiary)", outlineColor: GOLD }}
              >
                <svg
                  width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden
                  className="transition-transform duration-150"
                  style={{ transform: isOpen ? "rotate(180deg)" : undefined }}
                >
                  <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5"
                    strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
            {c.id ? (
              <Link
                href={`/ambassador-teams/captain/${encodeURIComponent(c.id)}?season=${encodeURIComponent(season)}`}
                className="font-medium hover:underline"
                style={{ color: "var(--glass-text)" }}
              >
                {c.name}
              </Link>
            ) : (
              <span className="font-medium" style={{ color: "var(--glass-text)" }}>{c.name}</span>
            )}
          </span>
        </td>
        <td className="px-4 py-2.5 text-right tabular" style={{ color: "var(--glass-text-secondary)" }}>
          {c.teams}
        </td>
        {hasFullRoster && (
          /* Green once every one of their teams can field a side, so a finished
             ambassador reads at a glance instead of by comparing two columns. */
          <td className="px-4 py-2.5 text-right tabular"
            style={{ color: c.fullRoster != null && c.fullRoster === c.teams
              ? "rgb(74,222,128)" : "var(--glass-text-secondary)" }}>
            {c.fullRoster ?? "—"}
          </td>
        )}
        {hasTeammates && (
          <td className="px-4 py-2.5 text-right tabular font-bold" style={{ color: "var(--glass-text)" }}>
            {c.teammates ?? "—"}
          </td>
        )}
        <td className="px-4 py-2.5 text-right tabular" style={{ color: "var(--glass-text-secondary)" }}>
          {c.avg == null ? "—" : c.avg.toFixed(1)}
        </td>
        {hasPaid && (
          <>
            <td className="px-4 py-2.5 text-right tabular font-bold" style={{ color: "var(--glass-text)" }}>
              {c.paid ?? "—"}
            </td>
            <td className="px-4 py-2.5 text-right tabular" style={{ color: "var(--glass-text-secondary)" }}>
              {c.avgPaid == null ? "—" : c.avgPaid.toFixed(1)}
            </td>
          </>
        )}
      </tr>
      {isOpen && (
        <tr style={{ background: "var(--glass-surface-hover)" }}>
          <td colSpan={colCount} className="px-4 py-3">
            <div className="space-y-3">
              {teams.map((t, ti) => {
                // Captain first, then whoever has paid least, so the chase list
                // is on top — same order as the captain detail page.
                const ordered = [...t.roster].sort(
                  (a, b) =>
                    Number(b.is_captain) - Number(a.is_captain) ||
                    a.paid - b.paid ||
                    a.player.localeCompare(b.player),
                );
                const paid = t.roster.filter((x) => x.paid_ok).length;
                return (
                  <div key={`${t.location}-${t.team}-${ti}`}>
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 max-w-2xl">
                      <span
                        className="inline-block w-1 h-3.5 rounded-sm align-middle shrink-0"
                        style={{ background: t.players === 0 ? "var(--glass-red)" : t.players === 1 ? THIN : GOLD }}
                      />
                      <span className="text-sm font-semibold" style={{ color: "var(--glass-text)" }}>{t.team}</span>
                      <span className="text-xs text-glass-text-tertiary">
                        {t.location} &middot; {t.day ?? "no night"}
                        {t.division ? ` · ${t.division}` : ""}
                      </span>
                      <span
                        className="text-xs tabular ml-auto shrink-0"
                        style={{ color: t.roster.length && paid === t.roster.length ? "var(--glass-text-secondary)" : THIN }}
                      >
                        {t.roster.length ? `${paid} of ${t.roster.length} paid` : "—"}
                      </span>
                    </div>
                    {ordered.length === 0 ? (
                      <p className="mt-1 text-[12px] italic text-glass-text-tertiary">No players on this roster yet.</p>
                    ) : (
                      <ul className="mt-1 space-y-0.5">
                        {ordered.map((x, i) => (
                          <li key={`${x.player}-${i}`} className="flex items-baseline gap-3 text-[12px] max-w-2xl">
                            <span className="truncate flex-1"
                              style={{ color: x.paid_ok ? "var(--glass-text-secondary)" : "var(--glass-text)" }}>
                              {x.player}
                              {x.is_captain && <span className="text-glass-text-tertiary"> (C)</span>}
                            </span>
                            <span
                              className="tabular font-mono shrink-0 w-[128px] text-right"
                              style={{ color: x.paid_ok ? "var(--glass-text-secondary)" : THIN }}
                              title={x.no_registration ? "No registration on file" : undefined}
                            >
                              {money(x)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
