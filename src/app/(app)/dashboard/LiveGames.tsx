import { locParam } from "@/lib/seasons";
import { promoFetch } from "@/lib/promo-feed";
import { localToIso } from "@/lib/tz";
import GameTime from "./GameTime";

// Live games: every game on today's schedule at each venue, live, upcoming
// and done, for the Live games page. The Promo Tracker reads the schedule from
// the ops DB; a game counts as live through its hour slot, since ops doesn't
// track games in real time.
const PROMO_APP_URL = process.env.PROMO_APP_URL ?? "https://registration-promo-tracker.vercel.app";

export type Game = {
  location: string;
  facility: string | null;
  court: string | null;
  division: string | null;
  home: string | null;
  away: string | null;
  starts_at: string;
  ends_at: string;
  tz: string;
  state: "live" | "later" | "done";
};

export async function loadLiveGames(locationNames: string[] | null): Promise<Game[] | null> {
  try {
    const url = new URL("/api/live-games", PROMO_APP_URL);
    const lp = locParam(locationNames);
    if (lp) url.searchParams.set("location", lp);
    const res = await promoFetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as { games?: Game[] };
    return Array.isArray(k.games) ? k.games : null;
  } catch {
    return null;
  }
}

// The game's start and end as instants, for GameTime to show in the viewer's
// zone; the schedule stores the venue's wall-clock time.
const startIso = (g: Game) => localToIso(g.starts_at, g.tz) ?? `${g.starts_at}:00Z`;
const endIso = (g: Game) => localToIso(g.ends_at, g.tz) ?? `${g.ends_at}:00Z`;
const Slot = ({ g }: { g: Game }) => <GameTime start={startIso(g)} end={endIso(g)} tz={g.tz} />;
// Court, time and division, joined with dots.
function Detail({ g }: { g: Game }) {
  return (
    <div className="text-[11px] text-glass-text-tertiary tabular">
      {g.court && <>{g.court} · </>}<Slot g={g} />{g.division && <> · {g.division}</>}
    </div>
  );
}

const LIVE_DOT: React.CSSProperties = { background: "var(--red)" };

// The game on BallerTV, found when clicked (see /go/ballertv).
const ballerTvHref = (g: Game) => `/go/ballertv?${new URLSearchParams({
  location: g.location, at: g.starts_at, tz: g.tz, home: g.home ?? "", away: g.away ?? "",
})}`;

export function BallerTvButton({ game }: { game: Game }) {
  return (
    <a href={ballerTvHref(game)} target="_blank" rel="noopener noreferrer"
      className="br-btn is-outline is-sm shrink-0"
      style={{ height: 26, padding: "0 10px", fontSize: 11 }}
      title="Watch on BallerTV (opens the game's stream, or its event if the game isn't listed)">
      BallerTV ↗
    </a>
  );
}

const STATE: Record<Game["state"], { label: string; style: React.CSSProperties }> = {
  live: { label: "Live", style: { color: "var(--red)", background: "var(--red-tint)" } },
  later: { label: "Upcoming", style: { color: "var(--glass-text-secondary)", background: "var(--fill-3)" } },
  done: { label: "Done", style: { color: "var(--glass-text-tertiary)", background: "var(--fill-3)" } },
};

// The Live games page: every game on today's schedule at each venue, live,
// upcoming and done, earliest first, venues with live games first.
export function AllGamesBody({ games }: { games: Game[] }) {
  const byLocation = new Map<string, Game[]>();
  for (const g of games) byLocation.set(g.location, [...(byLocation.get(g.location) ?? []), g]);
  const cards = [...byLocation.entries()].map(([loc, gs]) => ({
    loc,
    games: [...gs].sort((a, b) => a.starts_at.localeCompare(b.starts_at) || (a.court ?? "").localeCompare(b.court ?? "")),
    live: gs.filter((g) => g.state === "live").length,
    later: gs.filter((g) => g.state === "later").length,
  })).sort((a, b) =>
    (b.live > 0 ? 1 : 0) - (a.live > 0 ? 1 : 0) || (b.later > 0 ? 1 : 0) - (a.later > 0 ? 1 : 0) || a.loc.localeCompare(b.loc));

  if (cards.length === 0) {
    return (
      <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary shadow-card">
        No games on today&apos;s schedule in this scope.
      </div>
    );
  }
  return (
    <div className="grid gap-3 grid-cols-1 lg:grid-cols-2">
      {cards.map((c) => (
        <div key={c.loc} className="rounded-2xl bg-glass-surface px-4 py-3.5 min-w-0 shadow-card">
          <div className="flex items-baseline justify-between gap-2">
            <div className="min-w-0">
              <div className="font-semibold truncate" style={{ color: "var(--glass-text)" }}>{c.loc}</div>
              {c.games[0].facility && <div className="text-[11px] text-glass-text-tertiary truncate">{c.games[0].facility}</div>}
            </div>
            {c.live > 0 && (
              <span className="shrink-0 inline-flex items-center gap-1.5 text-[11px] font-semibold rounded-full px-2 py-0.5"
                style={{ color: "var(--red)", background: "var(--red-tint)" }}>
                <span className="inline-block h-1.5 w-1.5 rounded-full animate-pulse" style={LIVE_DOT} />
                {c.live} live
              </span>
            )}
          </div>
          <div className="mt-2.5">
            {c.games.map((g, i) => (
              <div key={i} className="flex items-center justify-between gap-3 py-2"
                style={{ borderTop: i ? "1px solid var(--glass-border)" : undefined, opacity: g.state === "done" ? 0.72 : 1 }}>
                <div className="min-w-0 flex items-start gap-3">
                  <span className="shrink-0 w-[68px] text-[11px] font-semibold rounded-md px-1.5 py-0.5 text-center mt-0.5"
                    style={STATE[g.state].style}>
                    {g.state === "live" ? "Live" : g.state === "later" ? <GameTime start={startIso(g)} tz={g.tz} mode="start" /> : "Done"}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm" style={{ color: "var(--glass-text)" }}>
                      <span className="font-semibold">{g.home ?? "TBD"}</span>
                      <span className="text-glass-text-tertiary"> vs </span>
                      <span className="font-semibold">{g.away ?? "TBD"}</span>
                    </div>
                    <Detail g={g} />
                  </div>
                </div>
                <BallerTvButton game={g} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export const gameCounts = (games: Game[]) => ({
  live: games.filter((g) => g.state === "live").length,
  later: games.filter((g) => g.state === "later").length,
  done: games.filter((g) => g.state === "done").length,
});
