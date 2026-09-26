"use client";

import Link from "next/link";
import { useState } from "react";
import TeamRosterBlock, { type RosterLine, type RosterTeam } from "@/components/TeamRosterBlock";

const GOLD = "var(--glass-gold)";

export type TableRosterEntry = RosterLine;
export type CaptainTeam = RosterTeam;

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
              {teams.map((t, ti) => (
                <TeamRosterBlock key={`${t.location}-${t.team}-${ti}`} team={t} />
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
