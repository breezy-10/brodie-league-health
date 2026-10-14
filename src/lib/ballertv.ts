import "server-only";

// Finds a game's stream on ballertv.com. The same lookup as Stats Health's
// (brodie-stats-health src/lib/ballertv.ts); change both together.
// BallerTV has no link back to our
// games, but each Brodie league-season is one BallerTV event named
// "Brodie <location> <season>" (e.g. "Brodie Brooklyn (Bushwick) Fall 2026" -
// our location names are the same strings), and the event's game list carries
// team names and start times. Event slugs are NOT derivable from the name
// (Toronto (Uptown) is "brodie-hoopdome-..."), so the event is looked up by name.

const BASE = "https://www.ballertv.com";
const API = `${BASE}/api/ballertv_web/v1`;
// BallerTV's API rejects requests without a browser user agent.
const HEADERS = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36" };

type BtvEvent = { name: string; url: string; type: string };
type BtvGame = { slug: string; title: string; scheduled_at: string | null; teams: { name: string }[] };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

async function getJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { headers: HEADERS, next: { revalidate: 600 } });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

async function findEventSlug(location: string, season: string): Promise<string | null> {
  // Some events drop our bracketed suffix: "Brampton (Game6)" -> "Brodie Brampton
  // Fall 2026", "Chicago (Homer Glen)" -> "Brodie Chicago Fall 2026".
  const plain = location.replace(/\s*\([^)]*\)/g, "").trim();
  for (const loc of plain !== location ? [location, plain] : [location]) {
    const name = `Brodie ${loc} ${season}`;
    const hits = await getJson<BtvEvent[]>(`${API}/autocomplete?q=${encodeURIComponent(name)}`);
    const want = norm(name);
    // Winter events carry a suffix ("... Winter 2026 (2025 - 2026)"), so match on the prefix.
    const hit = (hits ?? []).find((e) => e.type === "event" && norm(e.name).startsWith(want));
    if (hit) return hit.url.replace(/^\/events\//, "");
  }
  return null;
}

async function eventGames(slug: string): Promise<BtvGame[]> {
  const out: BtvGame[] = [];
  for (let page = 1; page <= 20; page++) {
    const d = await getJson<{ games?: BtvGame[]; has_more?: boolean }>(
      `${API}/event_detail/${encodeURIComponent(slug)}/games?page=${page}&per_page=100`,
    );
    out.push(...(d?.games ?? []));
    if (!d?.has_more) break;
  }
  return out;
}

// Scorekeepers type team names into BallerTV by hand ("blue label" for
// "Blue Label D4"), so an exact match scores 2 and a containment 1.
function nameScore(a: string, b: string): number {
  const x = norm(a), y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 2;
  if (Math.min(x.length, y.length) >= 3 && (x.includes(y) || y.includes(x))) return 1;
  return 0;
}

export type BallerTvGame = {
  location: string;
  season: string;
  gameDate: string;               // YYYY-MM-DD, local
  scheduledAt: string | null;     // timestamptz
  home: string | null;
  away: string | null;
};

/** The stream URL when the game is found, else the event's games page, else a BallerTV event search. */
export async function ballerTvUrl(g: BallerTvGame): Promise<string> {
  const eventName = `Brodie ${g.location} ${g.season}`;
  const slug = await findEventSlug(g.location, g.season);
  if (!slug) return `${BASE}/events?q=${encodeURIComponent(eventName)}`;
  const fallback = `${BASE}/events/${slug}/games`;
  if (!g.home || !g.away) return fallback;

  const games = await eventGames(slug);
  // Evening games anywhere from Eastern to Pacific time start between 04:00 UTC
  // on the game date and 09:00 UTC the next day.
  const dayStart = Date.parse(`${g.gameDate}T04:00:00Z`);
  const dayEnd = dayStart + 29 * 3600_000;
  const target = g.scheduledAt ? Date.parse(g.scheduledAt) : null;

  let best: { slug: string; score: number; gap: number } | null = null;
  for (const s of games) {
    if (!s.scheduled_at || s.teams.length < 2) continue;
    const t = Date.parse(s.scheduled_at);
    if (t < dayStart || t > dayEnd) continue;
    const [a, b] = [s.teams[0].name, s.teams[1].name];
    const straight = Math.min(nameScore(g.home, a), nameScore(g.away, b));
    const swapped = Math.min(nameScore(g.home, b), nameScore(g.away, a));
    const score = Math.max(straight, swapped);
    if (score === 0) continue;
    const gap = target ? Math.abs(t - target) : 0;
    if (!best || score > best.score || (score === best.score && gap < best.gap)) best = { slug: s.slug, score, gap };
  }
  return best ? `${BASE}/streams/${best.slug}` : fallback;
}
