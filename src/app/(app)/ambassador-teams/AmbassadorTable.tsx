"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import TeamRosterBlock, { StaffBadge, type RosterLine, type RosterTeam } from "@/components/TeamRosterBlock";
import { normName } from "@/lib/names";

const GOLD = "var(--glass-gold)";

export type TableRosterEntry = RosterLine;
export type CaptainTeam = RosterTeam;

// One row of the board: an ambassador, or a location. id links an ambassador
// to their own page; a location has none.
export type CaptainRow = {
  key: string;
  id: string | null;
  name: string;
  // The districts this row's teams sit in, from the districts app.
  districts: string[];
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

type Mode = "ambassadors" | "locations";

// The board, by ambassador or by location: a toggle above the card switches
// which, and each row opens onto its teams and who has paid on each.
export default function AmbassadorTable({
  rows,
  teamsByKey,
  locationRows,
  teamsByLocation,
  season,
  staff,
  hasFullRoster,
  hasTeammates,
  hasPaid,
  header,
  locationsHeader,
  locationCards,
}: {
  // Each view's title and explanation, drawn beside the Expand all toggle.
  header?: React.ReactNode;
  locationsHeader?: React.ReactNode;
  rows: CaptainRow[];
  teamsByKey: Record<string, CaptainTeam[]>;
  locationRows: CaptainRow[];
  teamsByLocation: Record<string, CaptainTeam[]>;
  season: string;
  // Normalised name -> role label (training roster + League Health users).
  staff: Record<string, string> | null;
  hasFullRoster: boolean;
  hasTeammates: boolean;
  hasPaid: boolean;
  // Each location's nights and team cards, drawn under the table in the
  // Locations view only.
  locationCards?: React.ReactNode;
}) {
  const [mode, setMode] = useState<Mode>("ambassadors");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const byLocation = mode === "locations";
  const shown = byLocation ? locationRows : rows;
  const teamsOf = byLocation ? teamsByLocation : teamsByKey;
  const colCount = 4 + (hasFullRoster ? 1 : 0) + (hasTeammates ? 1 : 0) + (hasPaid ? 2 : 0);
  // Only rows with teams to show can open, and the toggle's label names what a
  // click does: Collapse all once every one of them is open.
  const openable = shown.filter((c) => (teamsOf[c.key] ?? []).length > 0).map((c) => c.key);
  const allOpen = openable.length > 0 && openable.every((k) => open[`${mode}:${k}`]);
  const th = "px-4 py-2.5 font-bold sticky top-0 z-[2] bg-glass-surface";
  const thStyle = { borderBottom: "1px solid var(--glass-border)" };

  return (
    <div className="space-y-3">
      <div className="br-seg items-center">
        {(["ambassadors", "locations"] as const).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)} className={mode === m ? "is-on" : undefined}
            aria-pressed={mode === m} style={{ cursor: mode === m ? "default" : "pointer" }}>
            {m === "ambassadors" ? "Ambassadors" : "Locations"}
          </button>
        ))}
      </div>

      <div className="rounded-2xl bg-glass-surface overflow-hidden shadow-card">
        <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
          <div className="min-w-0 flex-1">{byLocation ? locationsHeader : header}</div>
          <button
            type="button"
            onClick={() => setOpen((o) => {
              const next = { ...o };
              for (const k of openable) next[`${mode}:${k}`] = !allOpen;
              return next;
            })}
            disabled={openable.length === 0}
            className={TOOL_BTN}
          >
            {allOpen ? <ChevronsDownUp size={13} /> : <ChevronsUpDown size={13} />}
            {allOpen ? "Collapse all" : "Expand all"}
          </button>
        </div>
        {/* The table scrolls inside this box, not the window, so its header
            sticks at the box's top (top-0). The page's --shell-top offset would
            pin it a header-height down, over the rows. */}
        <div className="overflow-x-auto" style={{ maxHeight: 460 }}>
          <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: 560 }}>
            <thead>
              <tr className="text-xs font-bold text-glass-text-tertiary">
                <th className={`${th} text-left`} style={thStyle}>{byLocation ? "Location" : "Ambassador"}</th>
                <th className={`${th} text-left`} style={thStyle}>District</th>
                <th className={`${th} text-right`} style={thStyle}>Teams</th>
                {hasFullRoster && <th className={`${th} text-right`} style={thStyle}>Teams with 7+</th>}
                {hasTeammates && <th className={`${th} text-right`} style={thStyle}>Teammates</th>}
                <th className={`${th} text-right`} style={thStyle}>Avg teammates per team</th>
                {hasPaid && (
                  <>
                    <th className={`${th} text-right`} style={thStyle}>Paid teammates</th>
                    <th className={`${th} text-right`} style={thStyle}>Avg paid per team</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => {
                const teams = [...(teamsOf[c.key] ?? [])].sort(
                  (a, b) =>
                    a.location.localeCompare(b.location) ||
                    dayRank(a.day) - dayRank(b.day) ||
                    a.team.localeCompare(b.team),
                );
                const k = `${mode}:${c.key}`;
                return (
                  <Row key={k} c={c} teams={teams} isOpen={!!open[k]} colCount={colCount} season={season}
                    staff={staff}
                    hasFullRoster={hasFullRoster} hasTeammates={hasTeammates} hasPaid={hasPaid}
                    toggle={() => setOpen((o) => ({ ...o, [k]: !o[k] }))} />
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {byLocation && locationCards}
    </div>
  );
}

function Row({
  c, teams, isOpen, colCount, season, staff, hasFullRoster, hasTeammates, hasPaid, toggle,
}: {
  c: CaptainRow;
  teams: CaptainTeam[];
  isOpen: boolean;
  colCount: number;
  season: string;
  staff: Record<string, string> | null;
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
            {staff?.[normName(c.name)] && <StaffBadge label={staff[normName(c.name)]} />}
          </span>
        </td>
        <td className="px-4 py-2.5" style={{ color: c.districts.length ? "var(--glass-text-secondary)" : "var(--glass-text-tertiary)" }}>
          {c.districts.length ? c.districts.join(", ") : "—"}
        </td>
        <td className="px-4 py-2.5 text-right tabular" style={{ color: "var(--glass-text-secondary)" }}>
          {c.teams}
        </td>
        {hasFullRoster && (
          /* Green once every one of the row's teams can field a side, so a
             finished one reads at a glance instead of by comparing columns. */
          <td className="px-4 py-2.5 text-right tabular"
            style={{ color: c.fullRoster != null && c.fullRoster === c.teams
              ? "var(--green)" : "var(--glass-text-secondary)" }}>
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
                <TeamRosterBlock key={`${t.location}-${t.team}-${ti}`} team={t} staff={staff ?? undefined} />
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// The same toggle as the discount drill-down's Expand all.
const TOOL_BTN =
  "inline-flex items-center gap-1.5 rounded-md border border-glass-border px-2.5 py-1 text-[11px] font-semibold shrink-0 "
  + "text-glass-text-tertiary hover:text-glass-text hover:border-glass-gold hover:bg-glass-surface-hover transition "
  + "disabled:opacity-40 disabled:pointer-events-none";
