import { requireUser } from "@/lib/auth";
import { loadActiveLMs, locParam, resolveScope } from "@/lib/seasons";
import Filters, { type FilterOptions } from "../dashboard/Filters";

// The Promo Tracker owns the ops-DB (Metabase) connection, so the ambassador
// roster comes from its feed rather than being re-derived here — same pattern
// as the Registrations and Referrals tabs. Overridable so a local dev server
// can point at a local promo tracker.
const PROMO_APP_URL = process.env.PROMO_APP_URL ?? "https://registration-promo-tracker.vercel.app";

type TeamRow = {
  team: string;
  captain: string | null;
  day: string | null;
  division: string | null;
  players: number;
};
type LocationRow = {
  location: string;
  teams: number;
  players: number;
  nights: number;
  rows: TeamRow[];
};
type AmbassadorFeed = {
  season: string;
  totals: {
    teams: number;
    players: number;
    locations: number;
    captains: number;
    captain_only: number;
    no_roster: number;
    no_captain: number;
    max_roster: number;
  };
  captain_teams: Record<string, number>;
  by_day: { day: string; teams: number; players: number }[];
  locations: LocationRow[];
};

async function loadAmbassadorTeams(
  season: string,
  locationNames: string[] | null,
): Promise<AmbassadorFeed | null> {
  try {
    const url = new URL("/api/ambassador-teams", PROMO_APP_URL);
    url.searchParams.set("season", season);
    const lp = locParam(locationNames);
    if (lp) url.searchParams.set("location", lp);
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as AmbassadorFeed;
    return k.locations ? k : null;
  } catch {
    return null;
  }
}

const GOLD = "var(--glass-gold)";
const THIN = "var(--glass-yellow)"; // captain-only roster
const EMPTY = "var(--glass-red)"; // no roster at all

const DAY_ABBR = (d: string) => d.slice(0, 3).toUpperCase();

export default async function AmbassadorTeamsView({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; location?: string; lm?: string }>;
}) {
  await requireUser();
  const { season: seasonParam, location = "all", lm = "all" } = await searchParams;

  const activeLMs = await loadActiveLMs();
  // Ambassador teams are registered for the season being sold, not the one
  // being played, so this defaults to the registration season like Referrals.
  const { promoLocations, promoSeasons, selectedSeason, locationNames } = await resolveScope(
    { season: seasonParam, location, lm },
    activeLMs,
    { defaultSeason: "registration" },
  );
  const feed = await loadAmbassadorTeams(selectedSeason, locationNames);

  const options: FilterOptions = {
    seasons: promoSeasons.map((s) => ({ value: s, label: s })),
    locations: promoLocations,
    lms: activeLMs.map((l) => ({ id: l.id, name: l.full_name || "—" })),
  };

  const t = feed?.totals;
  const locations = feed?.locations ?? [];
  const byDay = feed?.by_day ?? [];
  const maxDay = Math.max(...byDay.map((d) => d.teams), 1);
  // The meter is scaled to the season's largest roster rather than a fixed cap,
  // so it stays honest if a team ever carries more than ten.
  const slots = Math.max(t?.max_roster ?? 0, 1);
  const captainTeams = feed?.captain_teams ?? {};
  // Captains holding more than one team, counted season-wide by the feed so the
  // figure doesn't shrink when the page is filtered to a single location.
  const repeatCaptains = Object.entries(captainTeams)
    .filter(([, n]) => n > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  return (
    <main className="brodie-fade-in space-y-8">
      <header>
        <p className="font-mono text-xs uppercase tracking-[0.18em] mb-1" style={{ color: GOLD }}>
          Ambassador teams
        </p>
        <h1 className="text-3xl font-semibold tracking-tight" style={{ color: "var(--glass-text)" }}>
          Roster board
        </h1>
      </header>

      <Filters
        key={`${selectedSeason}|${location}|${lm}`}
        options={options}
        current={{ season: selectedSeason, location, lm }}
      />

      <section className="space-y-3">
        <div className="flex items-center gap-2.5">
          <h2 className="text-lg font-semibold" style={{ color: "var(--glass-text)" }}>
            Ambassador teams
          </h2>
          <span
            className="text-[9px] uppercase tracking-[0.16em] font-bold px-1.5 py-0.5 rounded"
            style={{ background: "var(--glass-gold-light, rgba(255,184,0,0.16))", color: GOLD }}
          >
            {selectedSeason}
          </span>
        </div>

        {!feed ? (
          <div className="rounded-xl border border-glass-border bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary">
            Ambassador feed unavailable — the Promo Tracker didn&apos;t answer for {selectedSeason}.
          </div>
        ) : locations.length === 0 ? (
          <div className="rounded-xl border border-glass-border bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary">
            No ambassador teams registered for {selectedSeason} in this scope yet.
          </div>
        ) : (
          <>
            <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
              <Tile label="Ambassador teams" value={t!.teams.toLocaleString()} accent={GOLD} />
              <Tile label="Locations" value={t!.locations.toLocaleString()} />
              <Tile label="Players placed" value={t!.players.toLocaleString()} />
              <Tile
                label="Distinct captains"
                value={t!.captains.toLocaleString()}
                sub={repeatCaptains.length ? `${repeatCaptains.length} run more than one team` : undefined}
              />
              <Tile
                label="Rosters at 0–1"
                value={(t!.captain_only + t!.no_roster).toLocaleString()}
                accent={THIN}
                sub={`${t!.captain_only} captain-only · ${t!.no_roster} empty`}
              />
            </div>

            {byDay.length > 0 && (
              <div className="rounded-2xl border border-glass-border bg-glass-surface px-4 py-4">
                <div className="text-[10px] uppercase tracking-[0.16em] font-bold text-glass-text-tertiary mb-3">
                  Teams by night
                </div>
                <div className="space-y-2">
                  {byDay.map((d) => (
                    <div key={d.day} className="flex items-center gap-3">
                      <div
                        className="font-mono text-[11px] uppercase tracking-[0.08em] w-20 shrink-0"
                        style={{ color: "var(--glass-text-secondary)" }}
                      >
                        {d.day}
                      </div>
                      <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: "var(--glass-border)" }}>
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${Math.max((d.teams / maxDay) * 100, 2)}%`, background: GOLD }}
                          title={`${d.teams} teams · ${d.players} players`}
                        />
                      </div>
                      <div className="tabular text-sm font-bold w-8 text-right" style={{ color: "var(--glass-text)" }}>
                        {d.teams}
                      </div>
                      <div className="tabular text-[11px] w-20 text-right text-glass-text-tertiary">
                        {d.players} players
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {repeatCaptains.length > 0 && (
              <div className="rounded-2xl border border-glass-border bg-glass-surface px-4 py-4">
                <div className="text-[10px] uppercase tracking-[0.16em] font-bold text-glass-text-tertiary mb-1">
                  Captains running more than one team
                </div>
                <p className="text-xs text-glass-text-tertiary mb-3">
                  Counted across the whole season. Losing one of these captains costs several teams at once.
                </p>
                <div className="flex flex-wrap gap-2">
                  {repeatCaptains.map(([name, n]) => (
                    <span
                      key={name}
                      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px]"
                      style={{ border: "1px solid var(--glass-border)", color: "var(--glass-text)" }}
                    >
                      {name}
                      <b className="tabular font-mono text-[11px]" style={{ color: GOLD }}>×{n}</b>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-3">
              {locations.map((loc) => (
                <LocationCard key={loc.location} loc={loc} slots={slots} captainTeams={captainTeams} />
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
}: {
  loc: LocationRow;
  slots: number;
  captainTeams: Record<string, number>;
}) {
  // Only the nights this location actually plays get a column, so a one-night
  // venue doesn't render six empty ones.
  const days: (string | null)[] = [];
  for (const r of loc.rows) if (!days.includes(r.day)) days.push(r.day);

  return (
    <div className="rounded-2xl border border-glass-border bg-glass-surface overflow-hidden">
      <div
        className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3"
        style={{ borderBottom: "1px solid var(--glass-border)" }}
      >
        <h3 className="font-semibold" style={{ color: "var(--glass-text)" }}>
          {loc.location}
        </h3>
        <div className="flex gap-4 font-mono text-[11px] text-glass-text-tertiary">
          <span>
            <b style={{ color: "var(--glass-text-secondary)" }}>{loc.teams}</b> teams
          </span>
          <span>
            <b style={{ color: "var(--glass-text-secondary)" }}>{loc.players}</b> players
          </span>
          <span>
            <b style={{ color: "var(--glass-text-secondary)" }}>{loc.nights}</b>{" "}
            {loc.nights === 1 ? "night" : "nights"}
          </span>
        </div>
      </div>

      <div className="grid gap-px" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(216px, 1fr))", background: "var(--glass-border)" }}>
        {days.map((day) => {
          const teams = loc.rows.filter((r) => r.day === day);
          return (
            <div key={day ?? "unscheduled"} className="bg-glass-surface px-3 py-3">
              <div
                className="flex items-center justify-between gap-2 pb-2 mb-2.5"
                style={{ borderBottom: "1px solid var(--glass-border)" }}
              >
                <span className="font-mono text-[11px] font-bold tracking-[0.14em]" style={{ color: GOLD }}>
                  {day ? DAY_ABBR(day) : "TBD"}
                </span>
                <span className="font-mono text-[11px] text-glass-text-tertiary">{teams.length}</span>
              </div>
              <ul className="space-y-2">
                {teams.map((r, i) => (
                  <TeamChip key={`${r.team}-${i}`} row={r} slots={slots} captainTeams={captainTeams} />
                ))}
              </ul>
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
}: {
  row: TeamRow;
  slots: number;
  captainTeams: Record<string, number>;
}) {
  const runs = row.captain ? captainTeams[row.captain] ?? 1 : 1;
  // The left edge carries roster state, so a thin roster reads before the
  // number does.
  const edge = row.players === 0 ? EMPTY : row.players === 1 ? THIN : GOLD;

  return (
    <li
      className="rounded-lg px-2.5 py-2 space-y-1.5"
      style={{
        border: "1px solid var(--glass-border)",
        borderLeft: `3px solid ${edge}`,
        background: "var(--glass-surface-hover)",
      }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold leading-tight break-words" style={{ color: "var(--glass-text)" }}>
          {row.team}
        </span>
        <span className="tabular font-mono text-[12px] font-bold shrink-0" style={{ color: "var(--glass-text-secondary)" }}>
          {row.players}
        </span>
      </div>

      <div className="flex items-center gap-1.5 text-[11.5px]" style={{ color: "var(--glass-text-secondary)" }}>
        <span
          className="font-mono text-[8.5px] font-bold px-1 py-px rounded shrink-0"
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
            {runs > 1 && (
              <span
                className="font-mono text-[10px] font-bold px-1 rounded shrink-0"
                style={{ border: `1px solid ${GOLD}`, color: GOLD }}
                title={`Runs ${runs} ambassador teams this season`}
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
    </li>
  );
}

function Flag({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      className="font-mono text-[9px] uppercase tracking-[0.06em] font-bold px-1.5 py-px rounded"
      style={{ border: `1px solid ${color}`, color }}
    >
      {children}
    </span>
  );
}

function Tile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-glass-border bg-glass-surface px-4 py-3.5 min-w-0">
      <div className="text-[10px] uppercase tracking-[0.16em] font-bold text-glass-text-tertiary truncate">{label}</div>
      <div className="mt-1.5 text-2xl font-bold tabular leading-tight" style={{ color: accent ?? "var(--glass-text)" }}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-glass-text-tertiary mt-1 leading-snug">{sub}</div>}
    </div>
  );
}
