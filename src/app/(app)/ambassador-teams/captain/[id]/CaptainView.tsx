import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { resolveScope, loadActiveLMs } from "@/lib/seasons";

const PROMO_APP_URL = process.env.PROMO_APP_URL ?? "https://registration-promo-tracker.vercel.app";

type RosterEntry = {
  player: string;
  is_captain: boolean;
  paid: number;
  currency: string | null;
  paid_ok: boolean;
  no_registration: boolean;
};
type PlayerTeam = {
  team: string;
  roster?: RosterEntry[];
  type: string; // 'ambassador' | 'squad' | 'franchise' | ''
  is_captain: boolean;
  location: string;
  day: string | null;
  division: string | null;
  players: number;
};
type PlayerFeed = {
  season: string;
  player: { id: string; name: string | null };
  totals: { teams: number; ambassador_teams: number; ambassador_captained: number; other_teams: number };
  teams: PlayerTeam[];
};

// Every team this person is on for the season, not just the ambassador teams
// they captain — an ambassador can also play on a squad team, or sit on an
// ambassador team someone else captains. Unscoped by location on purpose: this
// page is about one person, and several ambassadors run teams in more than one
// location (Duncan Lennox has four across three Calgary markets).
async function loadPlayer(season: string, playerId: string): Promise<PlayerFeed | null> {
  try {
    const url = new URL("/api/player-teams", PROMO_APP_URL);
    url.searchParams.set("season", season);
    url.searchParams.set("player_id", playerId);
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as PlayerFeed;
    return k.teams ? k : null;
  } catch {
    return null;
  }
}

const GOLD = "var(--glass-gold)";
const THIN = "var(--glass-yellow)";
const EMPTY = "var(--glass-red)";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const TYPE_LABEL: Record<string, string> = { squad: "Squad", franchise: "Franchise", "": "Team" };

export default async function CaptainView({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ season?: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const { season: seasonParam } = await searchParams;

  const activeLMs = await loadActiveLMs();
  const { selectedSeason } = await resolveScope(
    { season: seasonParam, location: "all", lm: "all" },
    activeLMs,
    { defaultSeason: "registration" },
  );

  const feed = await loadPlayer(selectedSeason, id);
  const boardHref = `/ambassador-teams?season=${encodeURIComponent(selectedSeason)}`;

  if (!feed) {
    return (
      <main className="brodie-fade-in space-y-6">
        <BackLink href={boardHref} />
        <div className="rounded-xl border border-glass-border bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary">
          Ambassador feed unavailable — the Promo Tracker didn&apos;t answer for {selectedSeason}.
        </div>
      </main>
    );
  }
  if (!feed.teams.length) notFound();

  const byDay = (a: PlayerTeam, b: PlayerTeam) => {
    const d = (x: string | null) => (x ? DAYS.indexOf(x) : 99);
    return d(a.day) - d(b.day) || b.players - a.players || a.team.localeCompare(b.team);
  };
  const ambassador = feed.teams.filter((t) => t.type === "ambassador").sort(byDay);
  const other = feed.teams.filter((t) => t.type !== "ambassador").sort(byDay);

  const captained = ambassador.filter((t) => t.is_captain);
  const players = captained.reduce((n, r) => n + r.players, 0);
  const avg = captained.length ? players / captained.length : 0;
  const locations = new Set(ambassador.map((r) => r.location)).size;
  const name = feed.player.name ?? "Ambassador";

  return (
    <main className="brodie-fade-in space-y-6">
      <div className="space-y-3">
        <BackLink href={boardHref} />
        <header>
          <p className="font-mono text-xs uppercase tracking-[0.18em] mb-1" style={{ color: GOLD }}>
            Ambassador · {selectedSeason}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight" style={{ color: "var(--glass-text)" }}>
            {name}
          </h1>
        </header>
      </div>

      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        <Tile label="Ambassador teams captained" value={String(captained.length)} accent={GOLD} />
        <Tile label="Players on those teams" value={String(players)} />
        <Tile label="Avg players per team" value={avg.toFixed(1)} />
        <Tile
          label={locations === 1 ? "Location" : "Locations"}
          value={String(locations)}
          sub={other.length ? `${other.length} other ${other.length === 1 ? "team" : "teams"} below` : undefined}
        />
      </div>

      <TeamTable
        title="Ambassador teams"
        note={
          captained.length === ambassador.length
            ? "Captained by this ambassador."
            : `${captained.length} captained, ${ambassador.length - captained.length} as a player.`
        }
        rows={ambassador}
        showRole={captained.length !== ambassador.length}
      />

      {other.length > 0 && (
        <TeamTable
          title="Other teams"
          note="Regular teams this person is on — not part of the ambassador programme, and not counted in the tiles above or on the roster board."
          rows={other}
          showRole
          showType
        />
      )}

      <p className="text-xs text-glass-text-tertiary">
        Every team this person is on in {selectedSeason}, across all locations — the location filter on the roster
        board does not narrow this page. Players are distinct active roster spots as of the last sync. The marker
        beside a team name flags a roster that is still just the captain, or empty. Open a team to see who is on it
        and what each person has paid.
      </p>
    </main>
  );
}

function TeamTable({
  title, note, rows, showRole = false, showType = false,
}: {
  title: string; note: string; rows: PlayerTeam[]; showRole?: boolean; showType?: boolean;
}) {
  // Laid out as a grid rather than a <table> so each team can be a native
  // disclosure — a <details> cannot wrap table rows.
  const cols = ["minmax(150px,2fr)"];
  if (showType) cols.push("84px");
  if (showRole) cols.push("84px");
  cols.push("minmax(110px,1.2fr)", "minmax(90px,1fr)", "minmax(100px,1.1fr)", "96px", "68px");
  const template = cols.join(" ");

  return (
    <section className="rounded-2xl border border-glass-border bg-glass-surface overflow-hidden">
      <div className="px-4 pt-4 pb-3">
        <div className="text-[10px] uppercase tracking-[0.16em] font-bold text-glass-text-tertiary mb-1">{title}</div>
        <p className="text-xs text-glass-text-tertiary">{note}</p>
      </div>
      <div className="overflow-x-auto">
        <div style={{ minWidth: 760 }}>
          <div
            className="grid gap-3 px-4 py-2.5 text-[10px] uppercase tracking-[0.16em] font-bold text-glass-text-tertiary"
            style={{ gridTemplateColumns: template, borderBottom: "1px solid var(--glass-border)" }}
          >
            <span>Team</span>
            {showType && <span>Type</span>}
            {showRole && <span>Role</span>}
            <span>Location</span>
            <span>Night</span>
            <span>Division</span>
            <span className="text-right">Paid</span>
            <span className="text-right">Players</span>
          </div>

          {rows.map((r, i) => (
            <TeamRowItem
              key={`${r.team}-${i}`}
              row={r}
              template={template}
              showRole={showRole}
              showType={showType}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function TeamRowItem({
  row, template, showRole, showType,
}: {
  row: PlayerTeam; template: string; showRole: boolean; showType: boolean;
}) {
  const roster = row.roster ?? [];
  const paid = roster.filter((x) => x.paid_ok).length;
  // Captain first, then whoever has paid least, so the chase list is on top.
  const ordered = [...roster].sort(
    (a, b) => Number(b.is_captain) - Number(a.is_captain) || a.paid - b.paid || a.player.localeCompare(b.player),
  );

  const cells = (
    <>
      <span className="font-semibold truncate" style={{ color: "var(--glass-text)" }} title={row.team}>
        <span
          className="inline-block w-1 h-3.5 rounded-sm mr-2 align-middle"
          style={{ background: row.players === 0 ? EMPTY : row.players === 1 ? THIN : GOLD }}
        />
        {row.team}
      </span>
      {showType && <span className="text-glass-text-tertiary truncate">{TYPE_LABEL[row.type] ?? row.type}</span>}
      {showRole && (
        <span style={{ color: "var(--glass-text-secondary)" }}>{row.is_captain ? "Captain" : "Player"}</span>
      )}
      <span className="truncate" style={{ color: "var(--glass-text-secondary)" }}>{row.location}</span>
      <span style={{ color: "var(--glass-text-secondary)" }}>{row.day ?? "—"}</span>
      <span className="text-glass-text-tertiary truncate">{row.division ?? "—"}</span>
      <span
        className="text-right tabular text-[12px]"
        style={{ color: roster.length && paid === roster.length ? "var(--glass-text-secondary)" : THIN }}
      >
        {roster.length ? `${paid} of ${roster.length}` : "—"}
      </span>
      <span className="text-right tabular font-bold" style={{ color: "var(--glass-text)" }}>{row.players}</span>
    </>
  );

  const rowClass = "grid gap-3 px-4 py-2.5 text-sm items-baseline";
  const rowStyle = { gridTemplateColumns: template, borderTop: "1px solid var(--glass-border)" };

  if (!roster.length) {
    return <div className={rowClass} style={rowStyle}>{cells}</div>;
  }

  return (
    <details className="group">
      <summary
        className={`${rowClass} cursor-pointer list-none [&::-webkit-details-marker]:hidden focus-visible:outline focus-visible:outline-2`}
        style={{ ...rowStyle, outlineColor: GOLD, outlineOffset: -2 }}
      >
        {cells}
      </summary>
      <ul
        className="px-4 pb-3 pt-1 space-y-1"
        style={{ background: "var(--glass-surface-hover)", borderTop: "1px solid var(--glass-border)" }}
      >
        {ordered.map((x, i) => (
          <li key={`${x.player}-${i}`} className="flex items-baseline justify-between gap-3 text-[12px] max-w-xl">
            <span className="truncate" style={{ color: x.paid_ok ? "var(--glass-text-secondary)" : "var(--glass-text)" }}>
              {x.player}
              {x.is_captain && <span className="text-glass-text-tertiary"> (C)</span>}
            </span>
            <span
              className="tabular font-mono shrink-0"
              style={{ color: x.paid_ok ? "var(--glass-text-secondary)" : THIN }}
              title={x.no_registration ? "No registration on file" : undefined}
            >
              {x.no_registration ? "no reg" : `$${Math.round(x.paid)}${x.currency ? " " + x.currency.toUpperCase() : ""}`}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function BackLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-[0.14em] hover:underline"
      style={{ color: "var(--glass-text-tertiary)" }}
    >
      <span aria-hidden>&larr;</span> Roster board
    </Link>
  );
}

function Tile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-glass-border bg-glass-surface px-4 py-3.5 min-w-0">
      <div className="text-[10px] uppercase tracking-[0.16em] font-bold text-glass-text-tertiary">{label}</div>
      <div className="mt-1.5 text-2xl font-bold tabular leading-tight" style={{ color: accent ?? "var(--glass-text)" }}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-glass-text-tertiary mt-1 leading-snug">{sub}</div>}
    </div>
  );
}
