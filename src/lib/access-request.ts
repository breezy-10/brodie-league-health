// Access requests and approvals for this app go to the Ops Hub, which posts
// them in #ops-apps-access-requests with every other Brodie app's. On an
// approval the hub replies in the request's thread, ticks it, and DMs the
// person and Sohaib; a denial is not reported. This app only reports the
// event, with ACCESS_EVENTS_KEY (the hub has the same key).
const HUB_EVENTS_URL = "https://brodie-ops-hub.vercel.app/api/access-events";
const APP_ID = "league-health";

type Result = { ok: boolean; error?: string };

async function report(
  event: "requested" | "approved",
  person: { email: string; name?: string | null; by?: string | null },
): Promise<Result> {
  const key = process.env.ACCESS_EVENTS_KEY;
  if (!key) {
    console.error("[access-request] ACCESS_EVENTS_KEY is not set");
    return { ok: false, error: "not_configured" };
  }
  try {
    const res = await fetch(HUB_EVENTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        app: APP_ID,
        event,
        email: person.email,
        name: person.name ?? null,
        by: person.by ?? null,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(`[access-request] hub answered ${res.status}:`, await res.text().catch(() => ""));
      return { ok: false, error: `hub_${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    console.error("[access-request] could not reach the hub:", err);
    return { ok: false, error: "hub_unreachable" };
  }
}

/** Someone signed in but isn't on this app's roster yet, and wants in. */
export function notifyAccessRequested(input: { email: string; fullName?: string | null }): Promise<Result> {
  return report("requested", { email: input.email, name: input.fullName });
}

/** Someone who was waiting on a request was let in. Never throws, so a Slack
 *  problem can't undo an approval. */
export function notifyAccessApproved(input: { email: string; name?: string | null; by?: string | null }): Promise<Result> {
  return report("approved", input);
}
