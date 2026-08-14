import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { resolveScope, loadActiveLMs } from "@/lib/seasons";

const PROMO_APP_URL = process.env.PROMO_APP_URL ?? "https://registration-promo-tracker.vercel.app";

type TeamRow = {
  team: string;
  captain: string | null;
  captain_id: string | null;
  day: string | null;
  division: string | null;
  players: number;
};
type AmbassadorFeed = {
  season: string;
  captains?: Record<string, { name: string; teams: number; players: number }>;
  locations: { location: string; rows: TeamRow[] }[];
};

// Deliberately unscoped by location: this page is about one person, and a
// captain who runs teams in two locations should show both regardless of the
// filter the board was left on.
async function loadFeed(season: string): Promise<AmbassadorFeed | null> {
  try {
    const url = new URL("/api/ambassador-teams", PROMO_APP_URL);
    url.searchParams.set("season", season);
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as AmbassadorFeed;
    return k.locations ? k : null;
  } catch {
    return null;
  }
}

const GOLD = "var(--glass-gold)";
const THIN = "var(--glass-yellow)";
const EMPTY = "var(--glass-red)";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

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

  const feed = await loadFeed(selectedSeason);
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

  const teams = feed.locations.flatMap((l) =>
    l.rows.filter((r) => r.captain_id === id).map((r) => ({ ...r, location: l.location })),
  );
  const name = feed.captains?.[id]?.name ?? teams[0]?.captain;
  if (!name) notFound();

  teams.sort((a, b) => {
    const d = (x: string | null) => (x ? DAYS.indexOf(x) : 99);
    return d(a.day) - d(b.day) || b.players - a.players || a.team.localeCompare(b.team);
  });

  const players = teams.reduce((n, r) => n + r.players, 0);
  const avg = teams.length ? players / teams.length : 0;
  const locations = new Set(teams.map((r) => r.location)).size;
  const nights = new Set(teams.map((r) => r.day).filter(Boolean)).size;

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
        <Tile label="Teams" value={String(teams.length)} accent={GOLD} />
        <Tile label="Players placed" value={String(players)} />
        <Tile label="Avg players per team" value={avg.toFixed(1)} />
        <Tile
          label={locations === 1 ? "Location" : "Locations"}
          value={String(locations)}
          sub={`${nights} ${nights === 1 ? "night" : "nights"}`}
        />
      </div>

      <div className="rounded-2xl border border-glass-border bg-glass-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: 640 }}>
            <thead>
              <tr className="text-[10px] uppercase tracking-[0.16em] font-bold text-glass-text-tertiary">
                <th className="px-4 py-2.5 text-left font-bold" style={{ borderBottom: "1px solid var(--glass-border)" }}>Team</th>
                <th className="px-4 py-2.5 text-left font-bold" style={{ borderBottom: "1px solid var(--glass-border)" }}>Location</th>
                <th className="px-4 py-2.5 text-left font-bold" style={{ borderBottom: "1px solid var(--glass-border)" }}>Night</th>
                <th className="px-4 py-2.5 text-left font-bold" style={{ borderBottom: "1px solid var(--glass-border)" }}>Division</th>
                <th className="px-4 py-2.5 text-right font-bold" style={{ borderBottom: "1px solid var(--glass-border)" }}>Players</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((r, i) => (
                <tr key={`${r.team}-${i}`} style={{ borderTop: "1px solid var(--glass-border)" }}>
                  <td className="px-4 py-2.5 font-semibold" style={{ color: "var(--glass-text)" }}>
                    <span
                      className="inline-block w-1 h-3.5 rounded-sm mr-2 align-middle"
                      style={{ background: r.players === 0 ? EMPTY : r.players === 1 ? THIN : GOLD }}
                    />
                    {r.team}
                  </td>
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
      </div>

      <p className="text-xs text-glass-text-tertiary">
        Every ambassador team this person captains in {selectedSeason}, across all locations — the location filter on
        the roster board does not narrow this page. Players are distinct active roster spots as of the last sync. The
        marker beside a team name flags a roster that is still just the captain, or empty.
      </p>
    </main>
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
      <div className="text-[10px] uppercase tracking-[0.16em] font-bold text-glass-text-tertiary truncate">{label}</div>
      <div className="mt-1.5 text-2xl font-bold tabular leading-tight" style={{ color: accent ?? "var(--glass-text)" }}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-glass-text-tertiary mt-1 leading-snug">{sub}</div>}
    </div>
  );
}
