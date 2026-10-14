import { forfeitTeamsHref, loadForfeitRisk, type ForfeitTeam } from "@/lib/forfeit-risk";
import { sameLocation } from "@/lib/location-match";
import { loadAmbassadorTeams, type AmbassadorFeed } from "./AmbassadorSummary";

// The bottom of the Ambassador teams page: every team one no-show from
// forfeiting (6 or fewer fully paid players), from the overdue app's Teams
// board, with the ambassador teams among them marked. It's about games being
// played, so it reads the season in play unless the filter names one.

const CHIP = "inline-block text-[11px] font-semibold rounded-md px-1.5 py-0.5 whitespace-nowrap";

// Team names compared between the overdue app and the ambassador feed:
// accents, punctuation and spacing don't decide a match, digits do.
const teamKey = (s: string) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function isAmbassador(t: ForfeitTeam, amb: AmbassadorFeed | null): boolean {
  const key = teamKey(t.team_name);
  return !!amb?.locations.some((l) => sameLocation(l.location, t.location) && l.rows.some((r) => teamKey(r.team) === key));
}

export default async function ForfeitRisk({
  season,
  locationNames,
  ambassadors,
}: {
  season: string;
  locationNames: string[] | null;
  // The ambassador feed for this season when the page already has it.
  ambassadors?: AmbassadorFeed | null;
}) {
  const [all, amb] = await Promise.all([
    loadForfeitRisk(season),
    ambassadors !== undefined ? ambassadors : loadAmbassadorTeams(season, locationNames),
  ]);
  const teams = all && locationNames
    ? all.filter((t) => locationNames.some((n) => sameLocation(t.location, n)))
    : all;
  // Alphabetical by location like the cards above, worst first within one.
  const rows = (teams ?? [])
    .map((t) => ({ ...t, ambassador: isAmbassador(t, amb) }))
    .sort((a, b) =>
      a.location.localeCompare(b.location) || a.paid_players - b.paid_players
      || a.team_name.localeCompare(b.team_name));
  const locations = new Set(rows.map((r) => r.location));
  const ambassadorCount = rows.filter((r) => r.ambassador).length;
  const shortRoster = rows.filter((r) => r.unpaid_players === 0).length;
  const href = forfeitTeamsHref(season, locations.size === 1 ? [...locations][0] : null);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <h2 className="text-lg font-semibold" style={{ color: "var(--glass-text)" }}>
            Forfeit risk
          </h2>
          <span className="text-[11px] font-bold px-1.5 py-0.5 rounded"
            style={{ background: "var(--fill-3)", color: "var(--glass-text)" }}>
            {season}
          </span>
        </div>
        {teams && (
          <a href={href} target="_blank" rel="noopener noreferrer" className="br-btn is-outline is-sm shrink-0">
            Open in B.O.B. ↗
          </a>
        )}
      </div>

      {!teams ? (
        <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm text-glass-text-tertiary shadow-card">
          <span className="font-semibold" style={{ color: "var(--glass-text-secondary)" }}>Not connected.</span>{" "}
          Forfeit risk comes from B.O.B., the overdue payments app, and League Health couldn&apos;t read it for {season}.
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary shadow-card">
          No teams at forfeit risk for {season} in this scope.
        </div>
      ) : (
        <>
          <p className="text-sm text-glass-text-secondary">
            {rows.length.toLocaleString()} {rows.length === 1 ? "team" : "teams"} at {locations.size}{" "}
            {locations.size === 1 ? "location" : "locations"} with 6 or fewer fully paid players
            {amb && <> · {ambassadorCount} {ambassadorCount === 1 ? "is an ambassador team" : "are ambassador teams"}</>}
            {shortRoster > 0 && <> · {shortRoster} with nobody owing, just a short roster</>}
          </p>

          <div className="rounded-2xl bg-glass-surface overflow-hidden shadow-card">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: 720, tableLayout: "fixed" }}>
                <colgroup>
                  {["20%", "32%", "13%", "13%", "11%", "11%"].map((w, i) => <col key={i} style={{ width: w }} />)}
                </colgroup>
                <thead>
                  <tr className="text-xs font-bold text-glass-text-tertiary">
                    <th className="px-4 py-2.5 text-left font-bold">Location</th>
                    <th className="px-4 py-2.5 text-left font-bold">Team</th>
                    <th className="px-4 py-2.5 text-left font-bold">Night</th>
                    <th className="px-4 py-2.5 text-left font-bold">Paid</th>
                    <th className="px-4 py-2.5 text-right font-bold">Owing</th>
                    <th className="px-4 py-2.5 text-right font-bold">Played</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const first = i === 0 || rows[i - 1].location !== r.location;
                    return (
                      <tr key={r.team_id}
                        style={{ borderTop: i === 0 ? "1px solid var(--glass-border)" : first ? "2px solid var(--glass-border-light)" : "1px solid var(--glass-border)" }}>
                        <td className="px-4 py-2.5 align-top" style={{ color: "var(--glass-text)" }}>
                          {first ? r.location : ""}
                        </td>
                        <td className="px-4 py-2.5 align-top">
                          <span className="font-semibold break-words" style={{ color: "var(--glass-text)" }}>{r.team_name}</span>
                          {r.ambassador && (
                            <span className={`${CHIP} ml-2`} style={{ color: "var(--glass-text)", background: "var(--fill-3)" }}>
                              Ambassador
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 align-top" style={{ color: "var(--glass-text-secondary)" }}>
                          {r.day ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 align-top tabular">
                          {/* Three or fewer reads red, as short rosters do across the app. */}
                          <span className={r.paid_players <= 3 ? CHIP : undefined}
                            style={r.paid_players <= 3
                              ? { color: "var(--red)", background: "var(--red-tint)" }
                              : { color: "var(--glass-text)" }}>
                            {r.paid_players} of {r.total_players}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 align-top text-right tabular"
                          style={{ color: r.unpaid_players ? "var(--glass-text)" : "var(--glass-text-tertiary)" }}>
                          {r.unpaid_players}
                        </td>
                        <td className="px-4 py-2.5 align-top text-right tabular" style={{ color: "var(--glass-text-secondary)" }}>
                          {r.checked_in_players ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <p className="text-xs text-glass-text-tertiary max-w-[80ch]">
        The teams on B.O.B.&apos;s Teams board for {season}: 6 or fewer fully paid players, so one no-show from
        forfeiting. Paid means not overdue for the season, B.O.B.&apos;s own rule, so an instalment not yet due counts
        as paid. Paid is out of the team&apos;s current roster; owing is how many on it are overdue, and a team with
        nobody owing is here for its short roster. Played counts roster players who have played a completed game
        this season. Who owes what is on B.O.B.
      </p>
    </section>
  );
}
