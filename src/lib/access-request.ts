// Access requests and decisions for this app go to the Ops Hub, which posts
// them in #ops-apps-access-requests with every other Brodie app's. On an
// approval it replies in the request's thread with the role given, ticks it,
// and DMs the person and Sohaib. On a denial it replies in the thread, marks
// it with an x and DMs Sohaib; the person is not told. This app only reports
// the event, with ACCESS_EVENTS_KEY (the hub knows the same key).
const HUB_EVENTS_URL = "https://brodie-ops-hub.vercel.app/api/access-events";
const APP_ID = "league-health";

type Result = { ok: boolean; error?: string };
type Decision = { email: string; name?: string | null; by?: string | null; role?: string | null };

async function report(event: "requested" | "approved" | "denied", body: Record<string, unknown>): Promise<Result> {
  const key = process.env.ACCESS_EVENTS_KEY;
  if (!key) {
    console.error("[access-request] ACCESS_EVENTS_KEY is not set");
    return { ok: false, error: "not_configured" };
  }
  try {
    const res = await fetch(HUB_EVENTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ app: APP_ID, event, ...body }),
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

const decision = (d: Decision) => ({ email: d.email, name: d.name ?? null, by: d.by ?? null, role: d.role ?? null });

/** Someone signed in but isn't on this app's roster yet, and wants in. */
export function notifyAccessRequested(input: { email: string; fullName?: string | null }): Promise<Result> {
  return report("requested", { email: input.email, name: input.fullName ?? null });
}

/** Someone who asked was let in. `role` is what they were given, as this app
 *  names it. Never throws, so a Slack problem can't undo the approval. */
export function notifyAccessApproved(input: Decision): Promise<Result> {
  return report("approved", decision(input));
}

/** Someone who asked was turned down. Never throws. */
export function notifyAccessDenied(input: Decision): Promise<Result> {
  return report("denied", decision(input));
}
