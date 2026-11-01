// Where each location's game-night score sheets go on Google Drive: OpsHub's
// "Score sheet upload links" (brodie-ops-hub src/lib/uploads.ts), keyed the
// way OpsHub names them, with the folder ids only. Those are Fall '26 season
// folders; Content Health's /api/scoresheets walks from one to any season's
// weekday and week folder, so re-pull this when OpsHub's list changes, not
// every season.
const SCORESHEET_FOLDERS: Record<string, string> = {
  "Boston": "1ug2lx7iLEurv_DM-lyYT20c9SUBwXOSj",
  "Brampton": "1l5Fs8OcG6U9XwwKygWeNJZfC2pz0eq9y",
  "Burlington": "10AvkjaG9QvxEUseZGyFL2zBDO6k7sQm0",
  "Burnaby": "13J4WVSqFYOqJWVPQASFH2WSOwIrYDs9X",
  "Bushwick": "1w0VlN-7cbALCaoGVNDiw0IouUm5DI93f",
  "Calgary": "1YDV7_P_ixZtzbC2M6Cmh7ra1B9yKO3PF",
  "Chicago": "1ASz0fayHd6upHFy8tuJd2qB1ezPG2SMY",
  "Edmonton": "1arU8PuJ9logpWeD8bw5o651zWKDJfIf0",
  "Greenpoint": "16CPEjlbxlCjg_bJaMDyiIljmOhCNoCsI",
  "HoopDome": "1a_WpcQk1W7S4LOwZEx8ngwm8DaJ7xP99",
  "Kitchener": "1RC58ESfr5jtOfY-yy-T12CLBqKDMvtpu",
  "London": "1eM86gYo4papFOp1QXuA3EHwtNb8gD8Tz",
  "Markham": "1nXHk_neJZkf91C7BQvpMNC0JPgEnmsR4",
  "Mississauga": "1H3A0OdziXrJJXG0ZcmjuJrw5AzRNMdmx",
  "Niagara": "11VMy6vHGVA__tym-s0wvfXfmM_TrVSAT",
  "Oakville": "1Anm0hj48UiN6yBxu89TYBNvJ41cPUKPE",
  "Oshawa": "1ZHxuunMzkRdcwJMnugIhl9pD34nAX_Cw",
  "Ottawa": "1c9erLBlanmH19Yo104DSUppwGg529YoW",
  "Richmond": "1kO5eSpwGO4HIueyKxFlpjsMXH2ZxOw1G",
  "Surrey": "1P0OIXKxuiAEDTrKjy9rz-5Weyt-ciss_",
  "Toronto (TMU)": "1L7fhgnLVLyLnDqCblcAGxiZ9kvbS7fmj",
  "Vaughan": "1WDq8g9HJzgRQaiyDzH2p0iXqBZWycyw4",
  "Winnipeg": "1OHW9Gj5v96wRVtYO9aRUfBqbvphNMPo5",
};

// OpsHub names some locations for the city or the venue, where League Health
// uses the ops league's name.
const ALIASES: [RegExp, string][] = [
  [/^boston\b/i, "Boston"],
  [/^calgary\b/i, "Calgary"],
  [/^chicago\b/i, "Chicago"],
  [/bushwick/i, "Bushwick"],
  [/greenpoint/i, "Greenpoint"],
  [/^toronto \(uptown\)|hoopdome/i, "HoopDome"],
  [/^toronto \(downtown\)/i, "Toronto (TMU)"],
];

const CONTENT_HEALTH_URL = process.env.CONTENT_HEALTH_URL ?? "https://brodie-content-health.vercel.app";
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function folderFor(location: string): string | null {
  const alias = ALIASES.find(([re]) => re.test(location))?.[1];
  if (alias) return SCORESHEET_FOLDERS[alias] ?? null;
  const key = Object.keys(SCORESHEET_FOLDERS).find((k) => k.toLowerCase() === location.trim().toLowerCase());
  return key ? SCORESHEET_FOLDERS[key] : null;
}

// A game night's score sheets: Content Health finds the night's week folder
// when the link is clicked ("Week 7" under "FA26 - WEDNESDAY"), else the
// weekday's, else the location's season folder. Null for a location OpsHub
// has no folder for. gameAt is the venue's own wall-clock time.
export function scoresheetsHref(r: { location: string; gameAt: string | null; season: string; week?: number | null }): string | null {
  const folder = folderFor(r.location);
  if (!folder) return null;
  const q = new URLSearchParams({ folder, season: r.season });
  if (r.gameAt) {
    const [y, m, d] = r.gameAt.slice(0, 10).split("-").map(Number);
    q.set("day", DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]);
  }
  if (r.week) q.set("week", String(r.week));
  return `${CONTENT_HEALTH_URL}/api/scoresheets?${q}`;
}
