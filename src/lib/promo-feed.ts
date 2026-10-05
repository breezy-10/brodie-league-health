import "server-only";
import { readAppSecret } from "@/lib/app-secrets";

// The Promo Tracker's feeds carry player names, payments and discount codes,
// so they answer only to a caller presenting its FEED_TOKEN. League Health
// reads them server-side with the token from PROMO_FEED_TOKEN, else the
// promo_feed_token row in its own app_secrets table (service role only).
const PROMO_HOST = "registration-promo-tracker.vercel.app";

// fetch, plus the feed token when the request is for the Promo Tracker.
// Requests to any other app go out unchanged, so call sites that fetch from
// several apps can use this throughout.
export async function promoFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const url = typeof input === "string" ? new URL(input) : input;
  if (url.host !== PROMO_HOST && url.host !== new URL(process.env.PROMO_APP_URL ?? `https://${PROMO_HOST}`).host) {
    return fetch(url, init);
  }
  const token = process.env.PROMO_FEED_TOKEN ?? (await readAppSecret("promo_feed_token"));
  const headers = new Headers(init.headers);
  if (token) headers.set("x-feed-token", token);
  return fetch(url, { ...init, headers });
}
