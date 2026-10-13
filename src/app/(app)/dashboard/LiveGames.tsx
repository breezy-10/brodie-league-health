import { locParam } from "@/lib/seasons";
import { promoFetch } from "@/lib/promo-feed";
import { TZ_SHORT } from "../drop-ins/ScheduledDropIns";

// Live games for the dashboard: the games on court right now at each venue,
// and what's still to come today. The Promo Tracker reads the schedule from
// the ops DB; a game counts as live through its hour slot, since ops doesn't
// track games in real time.
const PROMO_APP_URL = process.env.PROMO_APP_URL ?? "https://registration-promo-tracker.vercel.app";

type Game = {
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

// "2026-10-13T19:00" read as the venue's own clock.
function clock(at: string): string {
  const [hh, mm] = at.slice(11, 16).split(":").map(Number);
  return `${hh % 12 === 0 ? 12 : hh % 12}:${String(mm).padStart(2, "0")}`;
}
const ampm = (at: string) => (Number(at.slice(11, 13)) < 12 ? "am" : "pm");
const tzShort = (tz: string) => TZ_SHORT[tz] ?? "";
const slot = (g: Game) => `${clock(g.starts_at)}–${clock(g.ends_at)} ${ampm(g.ends_at)}${tzShort(g.tz) ? ` ${tzShort(g.tz)}` : ""}`;

const LIVE_DOT: React.CSSProperties = { background: "var(--red)" };

export function LiveGamesBody({ games }: { games: Game[] }) {
  const live = games.filter((g) => g.state === "live");
  const byLocation = new Map<string, Game[]>();
  for (const g of live) byLocation.set(g.location, [...(byLocation.get(g.location) ?? []), g]);
  const locations = [...byLocation.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  // Still to come today, per venue: how many and when the next one starts.
  const later = new Map<string, Game[]>();
  for (const g of games.filter((x) => x.state === "later")) later.set(g.location, [...(later.get(g.location) ?? []), g]);
  const laterRows = [...later.entries()]
    .map(([loc, gs]) => ({ loc, n: gs.length, next: gs.reduce((m, g) => (g.starts_at < m.starts_at ? g : m)) }))
    .sort((a, b) => a.loc.localeCompare(b.loc));
  const done = games.filter((g) => g.state === "done").length;

  return (
    <div className="space-y-3">
      {locations.length === 0 ? (
        <div className="rounded-xl bg-glass-surface px-4 py-6 text-sm text-glass-text-tertiary shadow-card">
          No games live right now.
          {games.length > 0 && laterRows.length === 0 && <> All {games.length} of today&apos;s games are done.</>}
          {games.length === 0 && <> Nothing on the schedule today.</>}
        </div>
      ) : (
        <div className="grid gap-3 grid-cols-1 md:grid-cols-3">
          {locations.map(([loc, gs]) => (
            <div key={loc} className="rounded-xl bg-glass-surface px-4 py-3.5 min-w-0 shadow-card">
              <div className="flex items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold truncate" style={{ color: "var(--glass-text)" }}>{loc}</div>
                  {gs[0].facility && <div className="text-[11px] text-glass-text-tertiary truncate">{gs[0].facility}</div>}
                </div>
                <span className="shrink-0 inline-flex items-center gap-1.5 text-[11px] font-semibold rounded-full px-2 py-0.5"
                  style={{ color: "var(--red)", background: "var(--red-tint)" }}>
                  <span className="inline-block h-1.5 w-1.5 rounded-full animate-pulse" style={LIVE_DOT} />
                  {gs.length} live
                </span>
              </div>
              <div className="mt-2.5 space-y-2">
                {gs.sort((a, b) => (a.court ?? "").localeCompare(b.court ?? "")).map((g, i) => (
                  <div key={i} className="text-sm leading-snug" style={{ borderTop: i ? "1px solid var(--glass-border)" : undefined, paddingTop: i ? 8 : 0 }}>
                    <div style={{ color: "var(--glass-text)" }}>
                      <span className="font-semibold">{g.home ?? "TBD"}</span>
                      <span className="text-glass-text-tertiary"> vs </span>
                      <span className="font-semibold">{g.away ?? "TBD"}</span>
                    </div>
                    <div className="text-[11px] text-glass-text-tertiary tabular">
                      {[g.court, slot(g), g.division].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {(laterRows.length > 0 || done > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          {laterRows.length > 0 && <span className="text-glass-text-tertiary mr-1">Later today:</span>}
          {laterRows.map((r) => (
            <span key={r.loc} className="font-semibold rounded-full px-2 py-0.5"
              style={{ color: "var(--glass-text-secondary)", background: "var(--fill-3)" }}>
              {r.loc} · {r.n} {r.n === 1 ? "game" : "games"} from {clock(r.next.starts_at)} {ampm(r.next.starts_at)}{tzShort(r.next.tz) ? ` ${tzShort(r.next.tz)}` : ""}
            </span>
          ))}
          {done > 0 && <span className="text-glass-text-tertiary ml-1">{done} done so far today</span>}
        </div>
      )}
    </div>
  );
}
