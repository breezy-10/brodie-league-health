import { readAppSecret } from "@/lib/app-secrets";

// City requests from the website's "request a city" form. The form posts each
// submission to the #location-requests Slack channel and keeps no copy
// anywhere else (not in the ops DB), so the channel is the record and this
// reads it with a Slack bot. Contact details are dropped here: only name,
// city, region, country and when leave this module.
//
// The bot is the "Brodie Registration Alerts" app (channels:history,
// channels:join), whose token sits in app_secrets as
// location_requests_slack_token. League Health's own SLACK_BOT_TOKEN is the
// Brodie CRM app, which can send but not read, and is only the fallback.
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
  // scanned: messages read; shape: the structure of the first bot message,
  // for when none of them parse (no content, only keys and block types).
  | { ok: true; requests: CityRequest[]; scanned?: number; shape?: string }
  | { ok: false; reason: string };

type SlackMessage = { ts: string; text?: string; bot_id?: string; [k: string]: unknown };

// Every piece of text in a message, in order: its text, and the text inside
// blocks and attachments. A rich text section's runs are joined into one
// string so "full_name:" and its value stay on the same line.
function collectText(node: unknown, out: string[]): void {
  if (Array.isArray(node)) { for (const n of node) collectText(n, out); return; }
  if (!node || typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  if (o.type === "rich_text_section" || o.type === "rich_text_preformatted" || o.type === "rich_text_quote") {
    const runs = (o.elements as Record<string, unknown>[] | undefined) ?? [];
    out.push(runs.map((e) => (typeof e.text === "string" ? e.text : typeof e.url === "string" ? e.url : "")).join(""));
    return;
  }
  // An attachment field is a title and a value: "city_requested: Nashville".
  const pair = typeof o.title === "string" && typeof o.value === "string";
  if (pair) out.push(`${o.title}: ${o.value}`);
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === "string") {
      if (k === "text" || k === "pretext" || (!pair && (k === "title" || k === "value"))) out.push(v);
    } else {
      collectText(v, out);
    }
  }
}

// "*city_requested:* Nashville" -> { city_requested: "Nashville" }. A label
// alone on its line ("*city_requested:*") takes the next line as its value.
function fields(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = text.split(/\r?\n/);
  const clean = (v: string) => v.replace(/<[^|>]*\|([^>]*)>/g, "$1").replace(/<([^>]*)>/g, "$1").replace(/^\*+|\*+$/g, "").trim();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*\*?\s*([A-Za-z_ ]+?)\s*:\s*\*?\s*(.*)$/);
    if (!m) continue;
    const key = m[1].trim().toLowerCase().replace(/\s+/g, "_");
    // Slack wraps addresses as <mailto:a@b.c|a@b.c>; keep the label.
    let value = clean(m[2]);
    if (!value && i + 1 < lines.length && !/:\s*\*?\s*$/.test(lines[i + 1])) value = clean(lines[i + 1]);
    if (value && !(key in out)) out[key] = value;
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
  const parts: string[] = [];
  if (typeof m.text === "string") parts.push(m.text);
  collectText({ blocks: m.blocks, attachments: m.attachments }, parts);
  const text = parts.join("\n");
  const f = fields(text);
  const city = (f.city_requested ?? "").trim();
  if (!city) return null;
  const email = (f.email ?? "").toLowerCase();
  // Staff trying the form out.
  if (email.endsWith("@brodierec.com")) return null;
  const rawName = (f.full_name ?? f.first_name ?? "").trim();
  // "(City Launcher)", "- City Launcher", "Guelph Launcher": they offered to
  // launch it.
  const launcher = /launcher/i.test(rawName);
  const name = rawName
    .replace(/[-–(]*\s*"?\s*(?:[A-Za-z]+\s+)?launcher\s*"?\s*\)?/i, "")
    .replace(/["“”]/g, "").trim() || "Unknown";
  const rawCountry = (f.country ?? "").trim();
  const countryKey = rawCountry.toLowerCase().replace(/\s*-\s*us$/, "");
  const country = rawCountry
    ? (COUNTRY[countryKey] ?? (countryKey.startsWith("united states") ? "United States" : titleCase(rawCountry)))
    : null;
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
  const token = (await readAppSecret("location_requests_slack_token"))
    ?? process.env.LOCATION_REQUESTS_SLACK_TOKEN ?? process.env.SLACK_BOT_TOKEN;
  if (!token) return { ok: false, reason: "No Slack token is set for reading #location-requests." };
  let joined = false;
  const requests: CityRequest[] = [];
  let scanned = 0;
  let shape = "";
  let cursor = "";
  try {
    for (let page = 0; page < 50; page++) {
      const url = new URL("https://slack.com/api/conversations.history");
      url.searchParams.set("channel", CHANNEL);
      url.searchParams.set("limit", "200");
      if (cursor) url.searchParams.set("cursor", cursor);
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const body = (await res.json()) as {
        ok: boolean; error?: string; needed?: string; provided?: string;
        messages?: SlackMessage[]; response_metadata?: { next_cursor?: string };
      };
      // A bot that may join public channels can let itself in the first time.
      if (!body.ok && body.error === "not_in_channel" && !joined) {
        joined = true;
        const j = (await (await fetch("https://slack.com/api/conversations.join", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify({ channel: CHANNEL }),
          cache: "no-store",
        })).json()) as { ok: boolean };
        if (j.ok) { page--; continue; }
      }
      if (!body.ok) {
        const why = body.error === "not_in_channel"
          ? "League Health's Slack app isn't in #location-requests. Add it to the channel (channel name, then Integrations, then Add apps)."
          : body.error === "missing_scope"
            // Slack lists every history scope as "needed"; a public channel
            // only takes channels:history.
            ? "The Slack app League Health is using can send messages but not read channels. Its token needs the channels:history scope: put the Brodie Registration Alerts bot token in League Health's app_secrets as location_requests_slack_token."
            : body.error === "channel_not_found"
              ? "League Health's Slack app can't see #location-requests. Add it to the channel."
              : `Slack said: ${body.error ?? "unknown error"}.`;
        // Which Slack app the token is, so the right one gets fixed: auth.test
        // needs no scope and names the bot.
        let who = "";
        try {
          const me = (await (await fetch("https://slack.com/api/auth.test", {
            headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
          })).json()) as { ok: boolean; user?: string };
          if (me.ok && me.user) who = ` The token is the @${me.user} bot`;
        } catch { /* identity is a nicety */ }
        if (who) who += body.provided ? ` (it can: ${body.provided}).` : ".";
        return { ok: false, reason: why + who };
      }
      for (const m of body.messages ?? []) {
        scanned++;
        const r = parseRequest(m);
        if (r) requests.push(r);
        else if (!shape && m.bot_id) {
          const blocks = Array.isArray(m.blocks) ? (m.blocks as { type?: string }[]).map((b) => b.type).join("+") : "none";
          const atts = Array.isArray(m.attachments) ? (m.attachments as Record<string, unknown>[]).map((a) => Object.keys(a).join("/")).join(" | ") : "none";
          shape = `keys ${Object.keys(m).join(",")}; text ${typeof m.text === "string" ? m.text.length : 0} chars; blocks ${blocks}; attachments ${atts}`;
        }
      }
      cursor = body.response_metadata?.next_cursor ?? "";
      if (!cursor) break;
    }
  } catch {
    return { ok: false, reason: "Slack didn't answer." };
  }
  return { ok: true, requests, scanned, shape };
}
