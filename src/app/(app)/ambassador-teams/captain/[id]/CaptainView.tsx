import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { resolveScope, loadActiveLMs } from "@/lib/seasons";

const PROMO_APP_URL = process.env.PROMO_APP_URL ?? "https://registration-promo-tracker.vercel.app";

type PlayerTeam = {
  team: string;
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
        beside a team name flags a roster that is still just the captain, or empty.
      </p>
    </main>
  );
}

function TeamTable({
  title, note, rows, showRole = false, showType = false,
}: {
  title: string; note: string; rows: PlayerTeam[]; showRole?: boolean; showType?: boolean;
}) {
  return (
    <section className="rounded-2xl border border-glass-border bg-glass-surface overflow-hidden">
      <div className="px-4 pt-4 pb-3">
        <div className="text-[10px] uppercase tracking-[0.16em] font-bold text-glass-text-tertiary mb-1">{title}</div>
        <p className="text-xs text-glass-text-tertiary">{note}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: 660 }}>
          <thead>
            <tr className="text-[10px] uppercase tracking-[0.16em] font-bold text-glass-text-tertiary">
              <Th>Team</Th>
              {showType && <Th>Type</Th>}
              {showRole && <Th>Role</Th>}
              <Th>Location</Th>
              <Th>Night</Th>
              <Th>Division</Th>
              <Th align="right">Players</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.team}-${i}`} style={{ borderTop: "1px solid var(--glass-border)" }}>
                <td className="px-4 py-2.5 font-semibold" style={{ color: "var(--glass-text)" }}>
                  <span
                    className="inline-block w-1 h-3.5 rounded-sm mr-2 align-middle"
                    style={{ background: r.players === 0 ? EMPTY : r.players === 1 ? THIN : GOLD }}
                  />
                  {r.team}
                </td>
                {showType && (
                  <td className="px-4 py-2.5 text-glass-text-tertiary">{TYPE_LABEL[r.type] ?? r.type}</td>
                )}
                {showRole && (
                  <td className="px-4 py-2.5" style={{ color: "var(--glass-text-secondary)" }}>
                    {r.is_captain ? "Captain" : "Player"}
                  </td>
                )}
                <td className="px-4 py-2.5" style={{ color: "var(--glass-text-secondary)" }}>{r.location}</td>
                <td className="px-4 py-2.5" style={{ color: "var(--glass-text-secondary)" }}>{r.day ?? "—"}</td>
                <td className="px-4 py-2.5 text-glass-text-tertiary">{r.division ?? "—"}</td>
                <td className="px-4 py-2.5 text-right tabular font-bold" style={{ color: "var(--glass-text)" }}>
                  {r.players}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th
      className={`px-4 py-2.5 font-bold ${align === "right" ? "text-right" : "text-left"}`}
      style={{ borderBottom: "1px solid var(--glass-border)" }}
    >
      {children}
    </th>
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
