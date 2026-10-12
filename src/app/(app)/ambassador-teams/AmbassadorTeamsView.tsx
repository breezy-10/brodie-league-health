import { requireUser } from "@/lib/auth";
import { canonicalLocation, csvParam, resolveScope } from "@/lib/seasons";
import Filters, { type FilterOptions } from "../dashboard/Filters";
import AmbassadorTable, { type CaptainTeam } from "./AmbassadorTable";
import { StaffBadge } from "@/components/TeamRosterBlock";
import { loadStaff } from "@/lib/staff";
import { normName } from "@/lib/names";
import { shortDiscount } from "@/lib/discount-names";
import { ChipTile as Tile } from "../dashboard/ChipTile";
import { AmbassadorSummaryTiles, loadAmbassadorTeams, type LocationRow, type TeamRow } from "./AmbassadorSummary";

const GOLD = "var(--glass-gold)";
const THIN = "var(--glass-yellow)"; // captain-only roster
const EMPTY = "var(--glass-red)"; // no roster at all

const DAY_ABBR = (d: string) => d.slice(0, 3).toUpperCase();
const DAY_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export default async function AmbassadorTeamsView({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; location?: string; lm?: string }>;
}) {
  await requireUser();
  const { season: seasonParam, location: locationParam } = await searchParams;
  const selectedSeasons = csvParam(seasonParam);
  const selectedLocations = csvParam(locationParam).map(canonicalLocation);

  // Ambassador teams are registered for the season being sold, not the one
  // being played, so this defaults to the registration season like Referrals.
  const { filterLocations, promoSeasons, selectedSeason, locationNames } = await resolveScope(
    { season: selectedSeasons[0], locations: selectedLocations },
    { defaultSeason: "registration" },
  );
  const [feed, staff] = await Promise.all([loadAmbassadorTeams(selectedSeason, locationNames), loadStaff()]);

  const options: FilterOptions = {
    seasons: promoSeasons.map((s) => ({ value: s, label: s })),
    locations: filterLocations,
  };

  const t = feed?.totals;
  // Alphabetical, so a location is found by name; the feed ranks them by
  // team count, which moved a location around as teams registered.
  const locations = [...(feed?.locations ?? [])].sort((a, b) => a.location.localeCompare(b.location));
  // The meter is scaled to the season's largest roster rather than a fixed cap,
  // so it stays honest if a team ever carries more than ten.
  const slots = Math.max(t?.max_roster ?? 0, 1);
  const captainTeams = feed?.captain_teams ?? {};
  // Captains holding more than one team, counted season-wide by the feed so the
  // figure doesn't shrink when the page is filtered to a single location.
  const captainPlayers = feed?.captain_players;
  // Every ambassador, including the 64 running a single team — the one-team
  // captains are most of the programme. Keyed by ops player id where the feed
  // supplies it, since two captains can share a name; an older feed falls back
  // to the name-keyed maps and simply doesn't link through.
  const captainRows = (feed?.captains
    ? Object.entries(feed.captains).map(([id, c]) => ({
        key: id, id, name: c.name, teams: c.teams, fullRoster: c.full_roster ?? null,
        teammates: c.teammates ?? null,
        // Teammates per team, so the column is the two beside it divided.
        // players/teams counted the ambassador themselves on every roster,
        // which is what made this read high next to the teammate count.
        avg: c.teams && c.teammates != null ? c.teammates / c.teams : null,
        paid: c.paid_teammates ?? null,
        avgPaid: c.teams && c.paid_teammates != null ? c.paid_teammates / c.teams : null,
      }))
    : Object.entries(captainTeams).map(([name, teams]) => ({
        key: name, id: null as string | null, name, teams, fullRoster: null as number | null,
        teammates: null as number | null,
        avg: teams ? (captainPlayers?.[name] ?? 0) / teams : null,
        paid: null as number | null, avgPaid: null as number | null,
      }))
  // Ordered by reach — how many people they actually play with — rather than
  // team count, which rewards signing up shells.
  ).sort((a, b) =>
    (b.teammates ?? 0) - (a.teammates ?? 0) || b.teams - a.teams || a.name.localeCompare(b.name));
  const hasTeammates = captainRows.some((c) => c.teammates !== null);
  const hasFullRoster = captainRows.some((c) => c.fullRoster !== null);
  const hasPaid = captainRows.some((c) => c.paid !== null);
  const multiTeam = captainRows.filter((c) => c.teams > 1).length;
  // Each ambassador's own teams, for the expander under their name. Keyed the
  // same way the rows are (ops player id, falling back to the name on an older
  // feed) so the two line up. Built from the already-scoped feed, so expanding
  // a row shows the teams inside the current location filter and nothing else.
  const teamsByKey: Record<string, CaptainTeam[]> = {};
  for (const loc of locations) {
    for (const r of loc.rows) {
      const key = r.captain_id ?? r.captain;
      if (!key) continue;
      (teamsByKey[key] ??= []).push({
        team: r.team,
        location: loc.location,
        day: r.day,
        division: r.division,
        players: r.players,
        roster: r.roster ?? [],
      });
    }
  }


  return (
    <main className="brodie-fade-in space-y-8">

      <Filters
        key={`${selectedSeasons.join(",")}|${selectedLocations.join(",")}`}
        options={options}
        current={{
          seasons: selectedSeasons.length ? selectedSeasons : [selectedSeason],
          locations: selectedLocations,
        }}
      />

      <section className="space-y-3">
        <div className="flex items-center gap-2.5">
          <h2 className="text-lg font-semibold" style={{ color: "var(--glass-text)" }}>
            Ambassador teams
          </h2>
          <span
            className="text-[11px] font-bold px-1.5 py-0.5 rounded"
            style={{ background: "var(--glass-gold-light, var(--fill-3))", color: GOLD }}
          >
            {selectedSeason}
          </span>
        </div>

        {!feed ? (
          <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary shadow-card">
            Ambassador feed unavailable — the Promo Tracker didn&apos;t answer for {selectedSeason}.
          </div>
        ) : locations.length === 0 ? (
          <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary shadow-card">
            No ambassador teams registered for {selectedSeason} in this scope yet.
          </div>
        ) : (
          <>
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-3">
              <AmbassadorSummaryTiles feed={feed} />
              <Tile
                label="Distinct captains"
                value={t!.captains.toLocaleString()}
                sub={multiTeam ? `${multiTeam} run more than one team` : undefined}
              />
            </div>

            {captainRows.length > 0 && (
              <div className="rounded-2xl bg-glass-surface overflow-hidden shadow-card">
                <AmbassadorTable
                  header={<>
                  <div className="text-xs font-bold text-glass-text-tertiary mb-1">
                    Ambassadors
                  </div>
                  <p className="text-xs text-glass-text-tertiary">
                    Every captain of an ambassador team in the current filter — {multiTeam} of{" "}
                    {captainRows.length} run more than one. Ordered by teammates — every roster spot they have
                    filled, counting a player on each team they are on. Teams with 7+ counts the ones that can
                    field a side, the captain included. Paid teammates are the ones who have paid
                    any amount toward their registration this season (on any team). Open the arrow beside a name for their
                    teams and who has paid on each; select the name for their full page.
                  </p>
                  </>}
                  rows={captainRows}
                  staff={staff}
                  teamsByKey={teamsByKey}
                  season={selectedSeason}
                  hasFullRoster={hasFullRoster}
                  hasTeammates={hasTeammates}
                  hasPaid={hasPaid}
                />
              </div>
            )}

            <div className="space-y-3">
              {locations.map((loc) => (
                <LocationCard key={loc.location} loc={loc} slots={slots} captainTeams={captainTeams} staff={staff} />
              ))}
            </div>
          </>
        )}

        <p className="text-xs text-glass-text-tertiary">
          A team counts as an ambassador team when ops marks it type &ldquo;ambassador&rdquo; and its season entry is
          registered and not withdrawn. Players are distinct active roster spots as of the last sync, so a low count
          means a roster still filling rather than a failed team. The captain is the player flagged as captain on the
          roster; a team can have none if nobody is flagged yet.
          {locations.length > 0 && (
            <> The meter shows {slots} slots — the largest ambassador roster this season — and each pip is one player.</>
          )}
        </p>
      </section>
    </main>
  );
}

function LocationCard({
  loc,
  slots,
  captainTeams,
  staff,
}: {
  loc: LocationRow;
  slots: number;
  captainTeams: Record<string, number>;
  staff: Record<string, string> | null;
}) {
  // Every night the location plays gets a column, ambassador team or not, so an
  // uncovered night shows as empty rather than missing. Only nights it plays,
  // so a one-night venue doesn't render six empty ones. A team with no night
  // goes in a TBD column at the end.
  const played = new Set<string | null>([...(loc.days ?? []), ...loc.rows.map((r) => r.day)]);
  const days: (string | null)[] = [
    ...DAY_ORDER.filter((d) => played.has(d)),
    ...[...played].filter((d): d is string => !!d && !DAY_ORDER.includes(d)),
    ...(played.has(null) ? [null] : []),
  ];

  return (
    <div className="rounded-2xl bg-glass-surface overflow-hidden shadow-card">
      <div
        className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3"
        style={{ borderBottom: "1px solid var(--glass-border)" }}
      >
        <h3 className="font-semibold" style={{ color: "var(--glass-text)" }}>
          {loc.location}
        </h3>
        <div className="flex gap-4 tabular text-[11px] text-glass-text-tertiary">
          <span>
            <b style={{ color: "var(--glass-text-secondary)" }}>{loc.teams}</b> teams
          </span>
          <span>
            <b style={{ color: "var(--glass-text-secondary)" }}>{loc.players}</b> players
          </span>
          <span>
            {loc.days ? (
              <>
                <b style={{ color: "var(--glass-text-secondary)" }}>{loc.nights}</b> of{" "}
                <b style={{ color: "var(--glass-text-secondary)" }}>{loc.days.length}</b>{" "}
                {loc.days.length === 1 ? "night" : "nights"}
              </>
            ) : (
              <>
                <b style={{ color: "var(--glass-text-secondary)" }}>{loc.nights}</b>{" "}
                {loc.nights === 1 ? "night" : "nights"}
              </>
            )}
          </span>
        </div>
      </div>

      {/* A location with captains but no known night (and no ambassador
          team) still says so, rather than showing an empty card. */}
      {days.length === 0 && (
        <div className="px-4 py-3">
          <div className="rounded-lg px-2.5 py-2 text-[11.5px] font-semibold"
            style={{ color: "var(--red)", background: "var(--red-tint)" }}>
            No ambassador team
          </div>
        </div>
      )}
      <div className="grid gap-px" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(216px, 1fr))", background: "var(--glass-border)" }}>
        {days.map((day) => {
          const teams = loc.rows.filter((r) => r.day === day);
          return (
            <div key={day ?? "unscheduled"} className="bg-glass-surface px-3 py-3">
              <div
                className="flex items-center justify-between gap-2 pb-2 mb-2.5"
                style={{ borderBottom: "1px solid var(--glass-border)" }}
              >
                <span className="tabular text-[11px] font-bold" style={{ color: GOLD }}>
                  {day ? DAY_ABBR(day) : "TBD"}
                </span>
                <span className="tabular text-[11px] text-glass-text-tertiary">{teams.length}</span>
              </div>
              {(() => {
                // The night's teams by division: every division open that
                // night, in order, each with its ambassador teams or a clear
                // note that it has none. A team with no division goes last.
                const open = (loc.divisions ?? []).filter((d) => d.day === day).map((d) => d.division);
                const names = [...new Set([...open, ...teams.map((r) => r.division).filter((d): d is string => !!d)])]
                  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
                const groups: { division: string | null; rows: TeamRow[] }[] = names.map((d) => ({
                  division: d, rows: teams.filter((r) => r.division === d),
                }));
                const undivided = teams.filter((r) => !r.division);
                if (undivided.length) groups.push({ division: null, rows: undivided });
                if (groups.length === 0) {
                  return <p className="text-xs italic text-glass-text-tertiary">No ambassador team</p>;
                }
                return (
                  <div className="space-y-3">
                    {groups.map((g) => (
                      <div key={g.division ?? "none"} className="space-y-1.5">
                        <div className="text-[11px] font-semibold text-glass-text-secondary">
                          {g.division ?? "No division"}
                        </div>
                        {g.rows.length === 0 ? (
                          <div className="rounded-lg px-2.5 py-2 text-[11.5px] font-semibold"
                            style={{ color: "var(--red)", background: "var(--red-tint)" }}>
                            No ambassador team
                          </div>
                        ) : (
                          <ul className="space-y-2">
                            {g.rows.map((r, i) => (
                              <TeamChip key={`${r.team}-${i}`} row={r} slots={slots} captainTeams={captainTeams} staff={staff} />
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TeamChip({
  row,
  slots,
  captainTeams,
  staff,
}: {
  row: TeamRow;
  slots: number;
  captainTeams: Record<string, number>;
  staff: Record<string, string> | null;
}) {
  const staffOf = (name: string | null) => (name ? staff?.[normName(name)] : undefined);
  const runs = row.captain ? captainTeams[row.captain] ?? 1 : 1;
  // The left edge carries roster state, so a thin roster reads before the
  // number does.
  const edge = row.players === 0 ? EMPTY : row.players === 1 ? THIN : GOLD;
  const roster = row.roster ?? [];
  const paid = roster.filter((r) => r.paid_ok).length;
  // Captain first, then whoever has paid least — the chase list surfaces
  // without having to read the whole roster.
  const ordered = [...roster].sort(
    (a, b) => Number(b.is_captain) - Number(a.is_captain) || a.paid - b.paid || a.player.localeCompare(b.player),
  );

  const head = (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold leading-tight break-words" style={{ color: "var(--glass-text)" }}>
          {row.team}
        </span>
        <span className="tabular text-[12px] font-bold shrink-0" style={{ color: "var(--glass-text-secondary)" }}>
          {row.players}
        </span>
      </div>

      <div className="flex items-center gap-1.5 text-[11.5px]" style={{ color: "var(--glass-text-secondary)" }}>
        <span
          className="tabular text-[8.5px] font-bold px-1 py-px rounded shrink-0"
          style={{
            background: row.captain ? "var(--glass-text-secondary)" : "var(--glass-text-tertiary)",
            color: "var(--glass-background)",
          }}
        >
          C
        </span>
        {row.captain ? (
          <>
            <span className="break-words">{row.captain}</span>
            {staffOf(row.captain) && <StaffBadge label={staffOf(row.captain)!} />}
            {runs > 1 && (
              <span
                className="tabular text-[11px] sm:text-[10px] font-bold px-1 rounded shrink-0"
                style={{ border: `1px solid ${GOLD}`, color: GOLD }}
                title={`Runs ${runs} ambassador teams in this view`}
              >
                ×{runs}
              </span>
            )}
          </>
        ) : (
          <span className="italic text-glass-text-tertiary">no captain set</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-glass-text-tertiary">
        {row.division && <span>{row.division}</span>}
        {row.players === 0 && <Flag color={EMPTY}>no roster</Flag>}
        {row.players === 1 && <Flag color={THIN}>captain only</Flag>}
      </div>

      <div className="flex gap-0.5" title={`${row.players} of ${slots} roster slots filled`}>
        {Array.from({ length: slots }, (_, i) => (
          <span
            key={i}
            className="h-1.5 flex-1 rounded-sm"
            style={{ background: i < row.players ? GOLD : "var(--glass-border)" }}
          />
        ))}
      </div>
    </>
  );

  const shell = {
    border: "1px solid var(--glass-border)",
    borderLeft: `3px solid ${edge}`,
    background: "var(--glass-surface-hover)",
  };

  // Nothing to open when the feed carries no roster (an older Promo Tracker)
  // or the team has nobody on it yet.
  if (!roster.length) {
    return <li className="rounded-lg px-2.5 py-2 space-y-1.5" style={shell}>{head}</li>;
  }

  return (
    <li className="rounded-lg" style={shell}>
      <details className="group">
        <summary
          className="px-2.5 py-2 space-y-1.5 cursor-pointer list-none rounded-lg
            [&::-webkit-details-marker]:hidden focus-visible:outline focus-visible:outline-2"
          style={{ outlineColor: GOLD, outlineOffset: -2 }}
        >
          {head}
          <div className="flex items-center justify-between gap-2 text-[11px] pt-0.5">
            <span style={{ color: paid === roster.length ? "var(--green)" : THIN }}>
              {paid} of {roster.length} paid
            </span>
            <span className="tabular text-[11px] sm:text-[10px] text-glass-text-tertiary group-open:hidden">Show roster</span>
            <span className="tabular text-[11px] sm:text-[10px] text-glass-text-tertiary hidden group-open:inline">Hide</span>
          </div>
        </summary>

        {/* Name on one line, what they've paid on the next, in the Ambassadors
            table's form: paid of price, then any discount and its code. */}
        <ul className="px-2.5 pb-2.5 pt-1.5 space-y-1.5" style={{ borderTop: "1px solid var(--glass-border)" }}>
          {ordered.map((r, i) => {
            const owes = !r.no_registration && r.total > 0;
            const cur = r.currency ? ` ${r.currency.toUpperCase()}` : "";
            return (
              <li key={`${r.player}-${i}`} className="text-[11.5px] leading-snug">
                <div className="truncate" style={{ color: owes ? "var(--glass-text)" : "var(--glass-text-secondary)" }} title={r.player}>
                  {r.player}
                  {r.is_captain && <span className="text-glass-text-tertiary"> (C)</span>}
                  {staffOf(r.player) && <StaffBadge label={staffOf(r.player)!} />}
                </div>
                <div className="truncate tabular text-[11px]" title={r.discount_names ?? (r.no_registration ? "No registration on file" : undefined)}>
                  {r.no_registration ? (
                    <span className="text-glass-text-tertiary">No registration on file</span>
                  ) : (
                    <>
                      <span style={{ color: owes ? "var(--glass-text)" : "var(--glass-text-secondary)" }}>
                        ${Math.round(r.paid)} / ${Math.round(r.total)}{cur}
                      </span>
                      {(r.discount ?? 0) > 0 && (
                        <>
                          <span className="font-bold" style={{ color: "var(--glass-text)" }}> {"\u2212"}${Math.round(r.discount ?? 0)}</span>
                          <span className="text-glass-text-tertiary">
                            {" \u00b7 "}{r.discount_names ? shortDiscount(r.discount_names) : "code removed"}
                          </span>
                        </>
                      )}
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </details>
    </li>
  );
}

function Flag({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      className="text-[11px] font-bold px-1.5 py-px rounded"
      style={{ border: `1px solid ${color}`, color }}
    >
      {children}
    </span>
  );
}
