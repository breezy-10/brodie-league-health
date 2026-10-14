// Time zone helpers shared by server and client code (no server imports).

// Short labels for the zones Brodie plays in, written the way Brodie staff
// write them (EST, PST) all year; anything else falls back to the browser's
// own abbreviation.
export const TZ_SHORT: Record<string, string> = {
  "America/New_York": "EST", "America/Toronto": "EST", "America/Detroit": "EST", "America/Montreal": "EST",
  "America/Chicago": "CST", "America/Winnipeg": "CST",
  "America/Denver": "MST", "America/Edmonton": "MST", "America/Phoenix": "MST",
  "America/Los_Angeles": "PST", "America/Vancouver": "PST",
};

// A local wall-clock time in a zone ("2026-10-13T19:00", "America/Vancouver"),
// as an ISO instant.
export function localToIso(local: string, tz: string): string | null {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).formatToParts(new Date(guess));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const shown = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
    return new Date(guess - (shown - guess)).toISOString();
  } catch {
    return null;
  }
}
