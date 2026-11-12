import "server-only";
import { unstable_cache } from "next/cache";
import { after } from "next/server";
import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external";
import { readAppSecret } from "@/lib/app-secrets";

// The Promo Tracker's feeds carry player names, payments and discount codes,
// so they answer only to a caller presenting its FEED_TOKEN. League Health
// reads them server-side with the token from PROMO_FEED_TOKEN, else the
// promo_feed_token row in its own app_secrets table (service role only).
const PROMO_HOST = "registration-promo-tracker.vercel.app";

// Reads are cached. Most of these feeds run live Metabase queries that take
// seconds when Metabase is well and minutes when it is backed up (Nov 10 2026:
// another app filled every Metabase query slot and each League Health page
// waited a minute or more). So a GET answers from Vercel's shared data cache:
// within FRESH_SECONDS it is served as is; after that the last good answer is
// served at once and refreshed in the background, so a page never waits on a
// feed it has read before. A failed refresh keeps the last good answer.
// Only successful answers are cached. The cache key is the URL alone, never
// the token or key a request carries.
//
// The background refresh has to be kept alive by hand (keepRefreshesAlive).
// Next queues it on the request and hands the queue to Vercel's waitUntil
// once, when the page shell is sent; nearly every section here streams in
// later inside its own Suspense, so its refresh joined the queue too late, the
// function froze before the feed answered, and the cached answer never
// changed. Nov 11 2026: Historical sat on the same teams and athletes for
// hours and never showed a chart whose feed field had shipped. Bumping the
// version below starts every feed afresh.
const FRESH_SECONDS = 300;
// Live games change by the minute.
const freshFor = (url: URL) => (url.pathname.startsWith("/api/live-games") ? 30 : FRESH_SECONDS);
// A feed that hasn't answered in this long is given up on, so a page shows
// the section as not connected instead of hanging. The upstream query is
// cancelled with it, which frees its Metabase slot.
const TIMEOUT_MS = 30_000;

type Cached = { status: number; body: string; type: string | null };
class FeedError extends Error {
  constructor(readonly answer: Cached) { super(`feed ${answer.status}`); }
}

async function readFresh(url: string, headers: [string, string][]): Promise<Cached> {
  const res = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  const answer = { status: res.status, body: await res.text(), type: res.headers.get("content-type") };
  // Thrown, not returned, so a failure is never cached and a stale answer
  // stays in place.
  if (!res.ok) throw new FeedError(answer);
  return answer;
}

// One cache function per freshness, keyed by URL. unstable_cache keys on every
// argument, so the headers (which carry the token) go through a side table
// instead of an argument.
const pendingHeaders = new Map<string, [string, string][]>();
const cachedReaders = new Map<number, (url: string) => Promise<Cached>>();
function cachedReader(seconds: number) {
  let reader = cachedReaders.get(seconds);
  if (!reader) {
    reader = unstable_cache(
      async (url: string) => readFresh(url, pendingHeaders.get(url) ?? []),
      ["feed-cache-v6", String(seconds)],
      { revalidate: seconds },
    );
    cachedReaders.set(seconds, reader);
  }
  return reader;
}

// Whatever cache work a read queued (a stale answer's refresh, or a new
// answer's write) is handed to after(), which keeps the function running
// until it is done however late in the stream the read came. Each piece once.
const handedOver = new WeakSet<Promise<unknown>>();
function keepRefreshesAlive() {
  try {
    const store = workAsyncStorage.getStore() as { pendingRevalidates?: Record<string, Promise<unknown>> } | undefined;
    const pending = Object.values(store?.pendingRevalidates ?? {}).filter((p) => !handedOver.has(p));
    if (!pending.length) return;
    for (const p of pending) handedOver.add(p);
    after(Promise.allSettled(pending));
  } catch {
    // Outside a request, or a Next without this store: nothing to keep alive.
  }
}

// Two sections asking for the same feed in one render share one request.
const inFlight = new Map<string, Promise<Cached>>();

async function cachedFetch(url: URL, headers: Headers): Promise<Response> {
  const key = url.toString();
  pendingHeaders.set(key, [...headers.entries()]);
  let p = inFlight.get(key);
  if (!p) {
    p = cachedReader(freshFor(url))(key).finally(() => inFlight.delete(key));
    inFlight.set(key, p);
  }
  try {
    const a = await p;
    keepRefreshesAlive();
    return new Response(a.body, { status: a.status, headers: a.type ? { "content-type": a.type } : undefined });
  } catch (e) {
    if (e instanceof FeedError) {
      return new Response(e.answer.body, { status: e.answer.status, headers: e.answer.type ? { "content-type": e.answer.type } : undefined });
    }
    // A timeout or network failure reads like any unreachable feed.
    return new Response(null, { status: 504 });
  }
}

const cacheable = (init: RequestInit) => (init.method ?? "GET").toUpperCase() === "GET" && init.body == null;

// fetch, plus the feed token when the request is for the Promo Tracker, and
// cached when it is a read. Requests to any other app get the cache too, so
// call sites that fetch from several apps can use this throughout.
export async function promoFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const url = typeof input === "string" ? new URL(input) : input;
  const headers = new Headers(init.headers);
  const isPromo = url.host === PROMO_HOST || url.host === new URL(process.env.PROMO_APP_URL ?? `https://${PROMO_HOST}`).host;
  if (isPromo) {
    const token = process.env.PROMO_FEED_TOKEN ?? (await readAppSecret("promo_feed_token"));
    if (token) headers.set("x-feed-token", token);
  }
  if (cacheable(init)) return cachedFetch(url, headers);
  return fetch(url, { ...init, headers });
}
