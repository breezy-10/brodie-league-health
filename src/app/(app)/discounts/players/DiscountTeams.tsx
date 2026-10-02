"use client";

import { useEffect, useState } from "react";
import TeamRosterBlock, { type RosterTeam } from "@/components/TeamRosterBlock";
import type { DiscountRowData } from "./DiscountTable";

type Team = RosterTeam & { removed?: boolean };
type Pair = { season_team_id: string; player_id: string | null };

// Same batching as the player view: 80 teams a call, three calls in flight.
const CHUNK = 80;
const PARALLEL = 3;

// Team view: every team with a discounted registration in scope, each as its
// roster block — who is on it, what each has paid, and what came off whose
// price. In the player list's order (largest discount first), one block per
// team however many of its players were discounted.
export default function DiscountTeams({
  rows, season, staff,
}: {
  rows: DiscountRowData[];
  season: string;
  staff: Record<string, string> | null;
}) {
  // One lookup per registered team. A player's own id goes with it, so a team
  // that has since been merged resolves to the one they're on now.
  const pairs: Pair[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r.season_team_id || seen.has(r.season_team_id)) continue;
    seen.add(r.season_team_id);
    pairs.push({ season_team_id: r.season_team_id, player_id: r.player_id ?? null });
  }
  const noTeam = rows.filter((r) => !r.season_team_id).length;
  const pairsKey = pairs.map((p) => p.season_team_id).join(",");

  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ok"; order: { teamId: string; moved: boolean; registeredAs: string | null }[]; teams: Record<string, Team> }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    (async () => {
      const chunks: Pair[][] = [];
      for (let i = 0; i < pairs.length; i += CHUNK) chunks.push(pairs.slice(i, i + CHUNK));
      const teams: Record<string, Team> = {};
      const resolved: Record<string, { season_team_id: string; moved: boolean }> = {};
      let at = 0;
      try {
        await Promise.all(
          Array.from({ length: Math.min(PARALLEL, chunks.length) }, async () => {
            while (at < chunks.length) {
              const chunk = chunks[at++];
              const res = await fetch("/api/team-roster", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                cache: "no-store",
                body: JSON.stringify({ season, pairs: chunk }),
              });
              const body = await res.json();
              if (!res.ok || !body.teams) throw new Error(body.error ?? `HTTP ${res.status}`);
              Object.assign(teams, body.teams);
              Object.assign(resolved, body.pairs);
            }
          }),
        );
      } catch (e) {
        if (!cancelled) setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
        return;
      }
      // Two registered teams can resolve to the one they were merged into;
      // that team shows once, where it first appears.
      const order: { teamId: string; moved: boolean; registeredAs: string | null }[] = [];
      const shown = new Set<string>();
      for (const p of pairs) {
        const hit = resolved[`${p.season_team_id}|${p.player_id ?? ""}`];
        if (!hit || shown.has(hit.season_team_id) || !teams[hit.season_team_id]) continue;
        shown.add(hit.season_team_id);
        order.push({
          teamId: hit.season_team_id,
          moved: hit.moved,
          registeredAs: rows.find((r) => r.season_team_id === p.season_team_id)?.team ?? null,
        });
      }
      if (!cancelled) setState({ status: "ok", order, teams });
    })();
    return () => { cancelled = true; };
    // pairsKey stands for pairs: a new scope means a new set of teams.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season, pairsKey]);

  return (
    <div className="rounded-2xl border border-glass-border bg-glass-surface overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-xs text-glass-text-tertiary"
        style={{ borderBottom: "1px solid var(--glass-border)" }}>
        {state.status === "loading" ? (
          <span className="inline-flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
            Loading {pairs.length} team{pairs.length === 1 ? "" : "s"}…
          </span>
        ) : state.status === "ok" ? (
          <span>
            {state.order.length} team{state.order.length === 1 ? "" : "s"} with a discounted registration
            {noTeam ? ` · ${noTeam} discounted registration${noTeam === 1 ? "" : "s"} with no team (player view lists them)` : ""}
          </span>
        ) : null}
      </div>
      {state.status === "error" ? (
        <p className="px-4 py-6 text-sm italic text-glass-text-tertiary">
          Couldn&apos;t load the rosters ({state.message}). Switch to player view, or reload to try again.
        </p>
      ) : state.status === "ok" ? (
        state.order.length === 0 ? (
          <p className="px-4 py-6 text-sm italic text-glass-text-tertiary">No team rosters to show.</p>
        ) : (
          <div>
            {state.order.map(({ teamId, moved, registeredAs }) => {
              const team = state.teams[teamId];
              return (
                <div key={teamId} className="px-4 py-3" style={{ borderTop: "1px solid var(--glass-border)" }}>
                  <TeamRosterBlock
                    team={team}
                    staff={staff ?? undefined}
                    note={moved
                      ? `Registered on ${registeredAs ?? "a team"}, which was merged — showing the team they're on now.`
                      : team.removed
                        ? "This team has since been removed from the league."
                        : undefined}
                  />
                </div>
              );
            })}
          </div>
        )
      ) : null}
    </div>
  );
}
