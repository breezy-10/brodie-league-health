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

// BC, Alberta and Manitoba stopped changing clocks in 2026 (UTC-7, -6 and -5
// all year). From spring to fall that's the same time as Pacific, Mountain and
// Central, so they keep the usual PST / MST / CST; in winter, once the US falls
// back, they're an hour ahead and read "BC time" / "Alberta time" / "Manitoba
// time" instead. Worked out per date from each zone's offset, so it follows
// the clock changes by itself.
const ALL_YEAR: Record<string, { label: string; usual: string }> = {
  "America/Vancouver": { label: "BC time", usual: "America/Los_Angeles" },
  "America/Edmonton": { label: "Alberta time", usual: "America/Denver" },
  "America/Winnipeg": { label: "Manitoba time", usual: "America/Chicago" },
};

function offsetMinutes(tz: string, at: Date): number | null {
  try {
    const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" })
      .formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "";
    const m = name.match(/GMT(?:([+-])(\d{2}):?(\d{2})?)?/);
    if (!m) return null;
    const mins = m[1] ? Number(m[2]) * 60 + Number(m[3] ?? 0) : 0;
    return m[1] === "-" ? -mins : mins;
  } catch {
    return null;
  }
}

// The short label for a zone on a date (a "YYYY-MM-DD..." string, local or
// ISO, or a Date; now if omitted). Undefined for zones not in TZ_SHORT.
export function tzShort(tz: string, at?: string | Date | null): string | undefined {
  const usual = TZ_SHORT[tz];
  const rule = ALL_YEAR[tz];
  if (!rule) return usual;
  // Only the date matters here, so a local wall-clock string is read at noon
  // UTC that day rather than as an instant in the viewer's zone.
  const when = at instanceof Date ? at
    : typeof at === "string" && /^\d{4}-\d{2}-\d{2}/.test(at) ? new Date(`${at.slice(0, 10)}T12:00:00Z`)
    : new Date();
  const mine = offsetMinutes(tz, when);
  const theirs = offsetMinutes(rule.usual, when);
  return mine != null && theirs != null && mine !== theirs ? rule.label : usual;
}

// " PST", " BC time", or "" - for appending to a formatted time.
export function tzSuffix(tz: string, at?: string | Date | null): string {
  const label = tzShort(tz, at);
  return label ? ` ${label}` : "";
}

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
