// City requests from the website's "request a city" form. The form posts each
// submission to the #location-requests Slack channel and keeps no copy
// anywhere else (not in the ops DB), so the channel is the record and this
// reads it with League Health's Slack bot. Contact details are dropped here:
// only name, city, region, country and when leave this module.
const CHANNEL = process.env.LOCATION_REQUESTS_CHANNEL_ID ?? "C0B5Y6R2YCE";

export type CityRequest = {
  ts: string;          // Slack message ts, unique per submission
  at: string;          // ISO time
  name: string;        // without the "(City Launcher)" tag
  launcher: boolean;   // they offered to launch the city
  city: string;
  region: string | null;
  country: string | null;
  person: string;      // a stable key for counting a person once per city
};

export type LocationRequests =
  | { ok: true; requests: CityRequest[] }
  | { ok: false; reason: string };

type SlackMessage = { ts: string; text?: string; blocks?: { text?: { text?: string } }[] };

// "*city_requested:* Nashville" -> { city_requested: "Nashville" }
function fields(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*\*?\s*([A-Za-z_ ]+?)\s*:\s*\*?\s*(.*)$/);
    if (!m) continue;
    const key = m[1].trim().toLowerCase().replace(/\s+/g, "_");
    // Slack wraps addresses as <mailto:a@b.c|a@b.c>; keep the label.
    const value = m[2].replace(/<[^|>]*\|([^>]*)>/g, "$1").replace(/<([^>]*)>/g, "$1").trim();
    if (value) out[key] = value;
  }
  return out;
}

const COUNTRY: Record<string, string> = {
  us: "United States", usa: "United States", "u.s.": "United States", "u.s.a.": "United States",
  "united states": "United States", "united states of america": "United States", america: "United States",
  ca: "Canada", can: "Canada", canada: "Canada",
  uk: "United Kingdom", "united kingdom": "United Kingdom", england: "United Kingdom", gb: "United Kingdom",
  ke: "Kenya", au: "Australia",
};
const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s\-/(])([a-z])/g, (_, a, b) => a + b.toUpperCase());

export function parseRequest(m: SlackMessage): CityRequest | null {
  const text = m.text || (m.blocks ?? []).map((b) => b.text?.text ?? "").join("\n");
  if (!/request-city/i.test(text)) return null;
  const f = fields(text);
  const city = (f.city_requested ?? "").trim();
  if (!city) return null;
  const rawName = (f.full_name ?? "").trim();
  const launcher = /city\s*launcher/i.test(rawName);
  const name = rawName.replace(/[-–(]*\s*city\s*launcher\s*\)?/i, "").trim() || "Unknown";
  const country = f.country ? (COUNTRY[f.country.trim().toLowerCase()] ?? titleCase(f.country.trim())) : null;
  const email = (f.email ?? "").toLowerCase();
  return {
    ts: m.ts,
    at: new Date(Number(m.ts) * 1000).toISOString(),
    name,
    launcher,
    city,
    region: f.province_state?.trim() || null,
    country,
    person: email || name.toLowerCase(),
  };
}

// Every submission in the channel, newest first. Read through the bot token
// League Health already uses for its Slack messages. Not cached: an answer
// like "missing scope" would otherwise stick around after it's been fixed.
export async function loadLocationRequests(): Promise<LocationRequests> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return { ok: false, reason: "League Health's Slack token (SLACK_BOT_TOKEN) isn't set." };
  const requests: CityRequest[] = [];
  let cursor = "";
  try {
    for (let page = 0; page < 50; page++) {
      const url = new URL("https://slack.com/api/conversations.history");
      url.searchParams.set("channel", CHANNEL);
      url.searchParams.set("limit", "200");
      if (cursor) url.searchParams.set("cursor", cursor);
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const body = (await res.json()) as {
        ok: boolean; error?: string; needed?: string;
        messages?: SlackMessage[]; response_metadata?: { next_cursor?: string };
      };
      if (!body.ok) {
        const why = body.error === "not_in_channel"
          ? "League Health's Slack app isn't in #location-requests. Add it to the channel (channel name, then Integrations, then Add apps)."
          : body.error === "missing_scope"
            // Slack lists every history scope as "needed"; a public channel
            // only takes channels:history.
            ? "League Health's Slack app can send messages but not read channels. In Slack's app settings (api.slack.com/apps, the League Health app, OAuth & Permissions), add the channels:history bot token scope, reinstall the app to the workspace, then add the app to #location-requests."
            : body.error === "channel_not_found"
              ? "League Health's Slack app can't see #location-requests. Add it to the channel."
              : `Slack said: ${body.error ?? "unknown error"}.`;
        return { ok: false, reason: why };
      }
      for (const m of body.messages ?? []) {
        const r = parseRequest(m);
        if (r) requests.push(r);
      }
      cursor = body.response_metadata?.next_cursor ?? "";
      if (!cursor) break;
    }
  } catch {
    return { ok: false, reason: "Slack didn't answer." };
  }
  return { ok: true, requests };
}
