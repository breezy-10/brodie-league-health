import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { sourceClient, sourceConfigured } from "@/lib/source-apps/clients";
import { resolveLocationsForLM, resolveLocationIdsByName } from "@/lib/source-apps/cross-app-locations";
import type { AppSlug } from "@/lib/source-apps/clients";
import { ymd } from "@/lib/source-apps/util";
import { canonicalLocation, loadActiveLMs, locParam, resolveScope, seasonKey, shortSeason } from "@/lib/seasons";
import Filters, { type FilterOptions } from "./Filters";
import { BasisToggle } from "./BasisToggle";

// Promo Tracker location name -> League Health league_managers.location_name,
// so selecting a location still matches the roster in the live sections.
const PROMO_TO_ROSTER: Record<string, string> = {
  "Brampton": "Brampton (Game6)",
  "Brooklyn - Bushwick": "Brooklyn (Bushwick)",
};

// Deep links to each source app's dashboard ("More details →").
const APP_URL: Record<string, string> = {
  crm: "https://brodie-crm-pro.vercel.app",
  promo: "https://registration-promo-tracker.vercel.app",
  feedback: "https://brodie-feedback.vercel.app",
  stats_health: "https://brodie-stats-health.vercel.app",
  content_health: "https://brodie-content-health.vercel.app",
  checklist: "https://brodie-season-success-checklist.vercel.app",
  training: "https://brodie-training.vercel.app/admin/reports",
  facilities: "https://brodie-facilities.vercel.app/calendar",
  overdue: "https://brodie-overdue-payments.vercel.app",
};

type Tone = "default" | "ok" | "warn" | "bad";
type Tile = {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  // Render `sub` beside the value instead of on its own line below it.
  subInline?: boolean;
  lines?: { text: string; strong?: boolean; pill?: { text: string; ok: boolean }; after?: string; color?: string; afterColor?: string }[];
  tone?: Tone;
  link?: { href: string; label: string };
  // A second headline number on the right of the same card, set at the same
  // size as the main value, with its own small label and follow-up lines.
  corner?: { label: string; value: string; color?: string; lines?: { text: string; color?: string }[] };
  // Named items behind the number — rendered as wrapped chips, tinted by tone.
  pills?: string[];
  pillsEmpty?: string;
  // Defaults to the card's tone; set when the chips mean something different
  // from the headline (an amber card listing red gaps).
  pillTone?: Tone;
};

type SnapRow = {
  raw_value: number | null;
  lm_id: string;
  metrics: { name: string; slug: string };
  apps: { slug: string; name: string };
  league_managers: { id: string; full_name: string | null; location_name: string | null; active: boolean };
};

function fmt(slug: string, avg: number): string {
  const rounded = Math.round(avg * 10) / 10;
  const pctish = /(pace|pct|sla|24h|rate|_in_|complete|response)/.test(slug);
  return pctish ? `${Math.round(avg)}%` : `${rounded}`;
}

// --- Sample cards (structure-first; wired to live source data in a follow-up) ---
const SAMPLE: Record<string, Tile[]> = {
  promo: [
    { label: "Teams registered", value: "365", sub: "across 19 locations" },
    { label: "Stories posted", value: "322", unit: "/ 365", sub: "88%", tone: "warn" },
    { label: "Highlights posted", value: "322", unit: "/ 365", sub: "88%", tone: "warn" },
    { label: "Avg time to post", value: "14h 40m", sub: "340 posts", tone: "warn" },
  ],
  feedback: [
    { label: "Responses", value: "2,477" },
    { label: "CSAT", value: "77%", sub: "145 of 188 rated 8 or higher", tone: "ok" },
    { label: "NPS", value: "28", sub: "53% promoters (972) · 25% detractors (460) of 1,850 scored", tone: "warn" },
    { label: "Returning intent", value: "52%", sub: "1,136 yes · 646 thinking · 408 no" },
  ],
  checklist: [
    { label: "Tasks complete", value: "39%", sub: "393 / 1,000", tone: "bad" },
    { label: "Overdue tasks", value: "231", sub: "Across all your checklists", tone: "bad" },
  ],
  overdue: [
    { label: "Total overdue players", value: "144", sub: "across 19 locations", tone: "bad" },
    { label: "Overdue Balance - Canadian Locations", value: "$20,799.32 CAD", sub: "80 players" },
    { label: "Overdue Balance - US Locations", value: "$13,184.17 USD", sub: "64 players" },
  ],
  content: [
    { label: "iPhone Clips · 12h", value: "22.0", unit: "/hr", sub: "target 20/hr", tone: "ok", lines: [{ text: "Drive", strong: true, pill: { text: "On time", ok: true }, after: "0m" }, { text: "Posted", strong: true, pill: { text: "On time", ok: true }, after: "9h 14m" }] },
    { label: "Photos · 3 days", value: "74.5", unit: "/hr", sub: "target 90/hr", tone: "bad", lines: [{ text: "Drive", strong: true, pill: { text: "On time", ok: true }, after: "3h" }, { text: "Posted", strong: true, pill: { text: "Late", ok: false }, after: "4d 2h" }] },
    { label: "Canto - players tagged", value: "673", unit: "/ 736", sub: "91% complete", tone: "ok", lines: [{ text: "673 this season · 0 past season" }] },
    { label: "App profiles", value: "641", unit: "/ 736", sub: "87% complete", tone: "ok", lines: [{ text: "577 current team · 64 previous team" }] },
  ],
  stats_health: [
    {
      label: "Stats completion rate",
      value: "98%",
      tone: "ok",
      lines: [
        { text: "834 — total games played", strong: true },
        { text: "2,018 — total games tracked", strong: true },
        { text: "1,901 — BallerTV" },
        { text: "11 — LiveBarn" },
        { text: "58 — In-venue" },
        { text: "48 — No stats" },
      ],
    },
    {
      label: "Full recording %",
      value: "91%",
      tone: "ok",
      lines: [
        { text: "1,845 — full" },
        { text: "173 — incomplete" },
        { text: "2,018 — total" },
      ],
    },
    {
      label: "Spare players",
      value: "464",
      tone: "warn",
      lines: [
        { text: "297 — games with spares" },
        { text: "464 — spare appearances" },
      ],
      link: { href: "https://brodie-stats-health.vercel.app", label: "See games with spares →" },
    },
  ],
};

// ---------------------------------------------------------------------------
// Read-through reporting layer. Each loader queries its source app directly,
// scoped to the selected season via the source's own season_id, and returns
// card tiles (or null when the source isn't wired -> caller uses the sample).
// ---------------------------------------------------------------------------

// Green >= 90%, yellow 70-89%, red < 70%.
const pctTone = (p: number): Tone => (p >= 90 ? "ok" : p >= 70 ? "warn" : "bad");

// locationNames = the resolved list of location names this view is scoped to
// (from the LM's district coverage, or a single selected location). null = all;
// [] = the filter resolves to no location.
type Scope = { locationNames: string[] | null };

// Resolve the scoped location names to this source's own location_id(s).
// null = no location filter (show all); [] = filter matches no location here.
async function sourceLocationIds(
  appSlug: Exclude<AppSlug, "facilities" | "crm">,
  scope: Scope,
): Promise<string[] | null> {
  if (!scope.locationNames) return null;
  if (!scope.locationNames.length) return [];
  const arrs = await Promise.all(scope.locationNames.map((n) => resolveLocationIdsByName(appSlug, n)));
  return [...new Set(arrs.flat())];
}

// Location names differ in how they mark the sub-venue across apps — the promo
// list writes "Brooklyn - Bushwick" where the checklist writes
// "Brooklyn (Bushwick)" — so brackets and dashes are flattened to spaces before
// comparing. A bare name ("Boston") still matches its only variant
// ("Boston North") via the shared-first-word rule.
const flattenLoc = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[()\-–—]/g, " ").replace(/\s+/g, " ").trim();
// Where an app names a market after its venue rather than its area. Facilities
// books "Toronto (Hoopdome)"; registrations and the checklist call the same
// market "Toronto (Uptown)". Without this they look like two markets, and the
// real one silently drops out of every cross-app comparison.
const LOCATION_ALIASES: Record<string, string> = {
  "toronto hoopdome": "toronto uptown",
};
const canonLoc = (s: string) => {
  const f = flattenLoc(s);
  return LOCATION_ALIASES[f] ?? f;
};
function sameLocation(a: string, b: string): boolean {
  const x = canonLoc(a), y = canonLoc(b);
  if (x === y) return true;
  if (x.includes(y) || y.includes(x)) return x.split(" ")[0] === y.split(" ")[0];
  return false;
}

// A booking counts as the venue being lined up once it's past "need to book" —
// the four statuses the facilities app offers after that.
const BOOKED_STATUSES = ["in_communication", "verbal_confirmation", "booked_with_flexibility", "booked_with_contract"];

// Which markets actually run a given season: the ones that have BOTH
// registrations (per the promo tracker) and facility bookings entered at one of
// the statuses above. A market with neither isn't operating, so it isn't
// expected to have a season checklist.
// The facilities season + venue lists are the same for every season on the
// page, so they're fetched once and shared by both checklist cards.
let facilityLookups: Promise<{ seasons: { id: string; name: string | null }[]; venues: { id: string; city: string | null }[] }> | null = null;
function getFacilityLookups() {
  if (facilityLookups) return facilityLookups;
  const fac = sourceClient("facilities")!;
  facilityLookups = (async () => {
    const [s, v] = await Promise.all([
      fac.from("seasons").select("id, name"),
      fac.from("facilities").select("id, city"),
    ]);
    return {
      seasons: (s.data ?? []) as { id: string; name: string | null }[],
      venues: (v.data ?? []) as { id: string; city: string | null }[],
    };
  })().catch(() => { facilityLookups = null; return { seasons: [], venues: [] }; });
  return facilityLookups;
}

async function loadOperatingLocations(season: string, candidates: string[]): Promise<string[] | null> {
  if (!candidates.length || !sourceConfigured("facilities")) return null;
  const want = seasonKey(season);
  try {
    const fac = sourceClient("facilities")!;
    const [{ seasons: fSeasons, venues: facilities }, pacingRes] = await Promise.all([
      getFacilityLookups(),
      (async () => {
        const url = new URL("/api/registration-pacing", "https://registration-promo-tracker.vercel.app");
        url.searchParams.set("season", season);
        url.searchParams.set("breakdown", "location");
        const r = await fetch(url.toString(), { cache: "no-store" });
        return r.ok ? ((await r.json()) as Pacing) : null;
      })(),
    ]);
    const seasonIds = fSeasons
      .filter((s) => s.name && seasonKey(s.name) === want).map((s) => s.id);
    if (!seasonIds.length || !pacingRes) return null;

    const cityById = new Map(facilities.map((f) => [f.id, f.city ?? ""]));
    const { data: bookings } = await fac.from("bookings")
      .select("facility_id").in("season_id", seasonIds).in("status", BOOKED_STATUSES);
    const bookedCities = new Set(((bookings ?? []) as { facility_id: string }[])
      .map((b) => cityById.get(b.facility_id) ?? "").filter(Boolean));
    if (!bookedCities.size) return null;

    const registered = (pacingRes.locations ?? [])
      .filter((l) => {
        const cur = l.seasons.find((s) => s.kind === "current");
        return !!cur && (cur.captains > 0 || cur.athletes > 0);
      })
      .map((l) => l.location);
    if (!registered.length) return null;

    return candidates.filter((n) =>
      registered.some((r) => sameLocation(n, r)) && [...bookedCities].some((c) => sameLocation(n, c)));
  } catch {
    return null;
  }
}

async function loadChecklistTiles(season: string, scope: Scope, expectedLocations: string[] = []): Promise<Tile[] | null> {
  if (!sourceConfigured("checklist")) return null;
  const sb = sourceClient("checklist")!;
  // Kick off the independent reads together — the operating-locations lookup
  // hits other apps entirely and used to wait behind the checklist queries.
  const operatingPromise = loadOperatingLocations(season, expectedLocations);
  const [locIds, { data: seasons }, { data: clLocs }] = await Promise.all([
    sourceLocationIds("checklist", scope),
    sb.from("seasons").select("id, name, location_id"),
    sb.from("locations").select("id, name"),
  ]);
  const locSet = locIds ? new Set(locIds) : null;
  const want = seasonKey(season);
  const seasonRows = ((seasons ?? []) as { id: string; name: string | null; location_id: string | null }[])
    .filter((s) => s.name && seasonKey(s.name) === want);
  const ids = seasonRows
    .filter((s) => !locSet || (s.location_id != null && locSet.has(s.location_id)))
    .map((s) => s.id);

  // Which locations have no checklist for this season at all. A location the
  // checklist app has never heard of counts as missing too, so this is matched
  // by name against the canonical list rather than by id.
  const withChecklist = new Set(seasonRows.map((s) => s.location_id).filter(Boolean) as string[]);
  let missingLocations: string[] = [];
  if (expectedLocations.length) {
    const rows = (clLocs ?? []) as { id: string; name: string }[];
    const inScope = scope.locationNames ? new Set(scope.locationNames) : null;
    // Only markets actually running this season are expected to have one. When
    // that can't be determined, fall back to every candidate rather than
    // silently reporting nothing outstanding.
    const operating = await operatingPromise;
    missingLocations = (operating ?? expectedLocations)
      .filter((n) => !inScope || inScope.has(n))
      .filter((n) => !rows.some((l) => sameLocation(n, l.name) && withChecklist.has(l.id)))
      .sort((a, b) => a.localeCompare(b));
  }
  const { data } = ids.length
    ? await sb.from("season_tasks").select("status, due_date").in("season_id", ids)
    : { data: [] as { status: string; due_date: string | null }[] };
  const list = (data ?? []) as { status: string; due_date: string | null }[];
  const total = list.length;
  const done = list.filter((t) => t.status === "done").length;
  const today = ymd(new Date());
  const overdue = list.filter((t) => t.due_date && t.due_date < today && t.status === "not_started").length;
  const pct = total ? Math.round((100 * done) / total) : 0;
  // Setup comes before progress: a location with no checklist isn't counted in
  // the percentages beside it, so it reads first.
  return [
    {
      label: `Checklist · ${season}`,
      value: missingLocations.length.toLocaleString(),
      sub: "locations not set up yet",
      subInline: true,
      tone: missingLocations.length > 0 ? "bad" : "ok",
      pills: missingLocations,
      pillsEmpty: "every location set up",
    },
    { label: `Tasks complete · ${season}`, value: `${pct}%`, sub: `${done.toLocaleString()} / ${total.toLocaleString()}`, tone: pct >= 100 ? "ok" : pct > 0 ? "warn" : "bad" },
    { label: `Overdue tasks · ${season}`, value: overdue.toLocaleString(), sub: "not started, past due", tone: overdue > 0 ? "bad" : "ok" },
  ];
}

// Feedback reads the feedback app's OWN KPI feed (response_summary RPC), so the
// numbers match its site exactly — correct season (survey.intended_season_id)
// and pagination included. Returns null on failure -> sample.
async function loadFeedbackTiles(season: string, scope: Scope): Promise<Tile[] | null> {
  try {
    const url = new URL("/api/dashboard-kpis", "https://brodie-feedback.vercel.app");
    url.searchParams.set("season", season);
    const lp = locParam(scope.locationNames); if (lp) url.searchParams.set("location", lp);
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as {
      responses: number; csat_pct: number | null; csat_tone: Tone; csat_satisfied: number; csat_total: number;
      nps: number | null; nps_tone: Tone; promoters: number; detractors: number; nps_total: number;
      promoter_pct: number | null; detractor_pct: number | null;
      retention_pct: number | null; retention_yes: number; retention_thinking: number; retention_no: number;
    };
    // Tones come from the feedback site's own colour functions (csatColor/npsColor);
    // Returning intent is left uncoloured, matching that site.
    return [
      { label: "Responses", value: k.responses.toLocaleString() },
      { label: "CSAT", value: k.csat_pct == null ? "—" : `${k.csat_pct}%`, sub: k.csat_pct == null ? "no CSAT question" : `${k.csat_satisfied} of ${k.csat_total} rated 8 or higher`, tone: k.csat_tone ?? "default" },
      { label: "NPS", value: k.nps == null ? "—" : `${k.nps}`, sub: k.nps == null ? "no NPS scored" : `${k.promoter_pct}% promoters (${k.promoters}) · ${k.detractor_pct}% detractors (${k.detractors}) of ${k.nps_total} scored`, tone: k.nps_tone ?? "default" },
      { label: "Returning intent", value: k.retention_pct == null ? "—" : `${k.retention_pct}%`, sub: k.retention_pct == null ? "no retention question" : `${k.retention_yes} yes · ${k.retention_thinking} thinking · ${k.retention_no} no` },
    ];
  } catch {
    return null;
  }
}

// Content Health reads the app's OWN KPI feed (SLA + expected-delivery math),
// so the iPhone Clips + Photos cards match its site exactly. Null -> sample.
type ContentCard = {
  delivered: number; hours_worked: number; rate: number | null; target: number;
  expected_pct: number | null; sla_pct: number | null;
  drive_ms: number | null; drive_on_time: boolean | null;
  post_ms: number | null; post_on_time: boolean | null;
  // Same figures for the previous week; only present in Weekly Review.
  prev?: { rate: number | null; drive_ms: number | null; post_ms: number | null } | null;
};
// "0m", "9h 14m", "1d 4h" — matches Content Health's formatElapsedShort.
function fmtElapsed(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) { const m = mins % 60; return m ? `${hours}h ${m}m` : `${hours}h`; }
  const days = Math.floor(hours / 24); const h = hours % 24;
  return h ? `${days}d ${h}h` : `${days}d`;
}
function timingLine(label: string, ms: number | null, onTime: boolean | null): { text: string; strong?: boolean; pill?: { text: string; ok: boolean }; after?: string } {
  if (ms == null) return { text: label, strong: true, after: "—" };
  return { text: label, strong: true, pill: { text: onTime ? "On time" : "Late", ok: !!onTime }, after: fmtElapsed(ms) };
}
function contentTile(label: string, c: ContentCard): Tile {
  const p = c.prev;
  const lines: NonNullable<Tile["lines"]> = [
    timingLine("Drive", c.drive_ms, c.drive_on_time),
    timingLine("Posted", c.post_ms, c.post_on_time),
  ];
  if (p) {
    // Week-over-week. Faster delivery is better, so the timing deltas invert.
    const elapsedDelta = (cur: number | null, prev: number | null) => {
      if (cur == null || prev == null) return null;
      const d = cur - prev;
      return { text: `${d > 0 ? "+" : d < 0 ? "−" : ""}${fmtElapsed(Math.abs(d))}`, color: upColor(-d) };
    };
    const rateDelta = c.rate != null && p.rate != null ? Math.round((c.rate - p.rate) * 10) / 10 : null;
    lines.push({
      text: `prev week ${p.rate == null ? "—" : `${p.rate.toFixed(1)}/hr`}`,
      ...(rateDelta != null ? { after: `${rateDelta > 0 ? "+" : ""}${rateDelta.toFixed(1)}`, afterColor: upColor(rateDelta) } : {}),
    });
    const dd = elapsedDelta(c.drive_ms, p.drive_ms);
    const pd = elapsedDelta(c.post_ms, p.post_ms);
    if (p.drive_ms != null) lines.push({ text: `prev Drive ${fmtElapsed(p.drive_ms)}`, ...(dd ? { after: dd.text, afterColor: dd.color } : {}) });
    if (p.post_ms != null) lines.push({ text: `prev Posted ${fmtElapsed(p.post_ms)}`, ...(pd ? { after: pd.text, afterColor: pd.color } : {}) });
  }
  return {
    label, value: c.rate == null ? "—" : c.rate.toFixed(1), unit: "/hr",
    sub: `target ${c.target}/hr`,
    tone: c.rate == null ? "default" : c.rate >= c.target ? "ok" : "bad",
    lines,
  };
}
async function loadContentTiles(season: string, scope: Scope, week?: string): Promise<Tile[] | null> {
  try {
    const url = new URL("/api/dashboard-kpis", "https://brodie-content-health.vercel.app");
    url.searchParams.set("season", season);
    if (week) url.searchParams.set("week", week);
    const lp = locParam(scope.locationNames); if (lp) url.searchParams.set("location", lp);
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as {
      clips: ContentCard; photos: ContentCard;
      canto?: RosterCard; app?: RosterCard;
    };
    const tiles = [contentTile("iPhone Clips · 12h", k.clips), contentTile("Photos · 3 days", k.photos)];
    if (k.canto) tiles.push(rosterTile("Canto - players tagged", k.canto, `${k.canto.this_season} this season · ${k.canto.past_season} past season`, "tagged"));
    if (k.app) tiles.push(rosterTile("App profiles", k.app, `${k.app.current_team} current team · ${k.app.previous_team} previous team`, "set"));
    return tiles;
  } catch {
    return null;
  }
}

type RosterCard = {
  done: number; total: number; pct: number; this_season: number; past_season: number;
  current_team: number; previous_team: number;
  week?: { count: number; prev_count: number; delta: number } | null;
};
// In Weekly Review the headline becomes the week's own count (how many athletes
// were tagged / had a profile set that week), with the previous week and the
// delta beneath it; season-to-date completion moves to a supporting line.
function rosterTile(label: string, c: RosterCard, split: string, noun: string): Tile {
  const w = c.week;
  if (w) {
    return {
      label, value: w.count.toLocaleString(), unit: noun,
      sub: `${c.done.toLocaleString()} / ${c.total.toLocaleString()} season to date · ${c.pct}%`,
      tone: w.count === 0 ? "default" : "ok",
      lines: [
        { text: `prev week ${w.prev_count.toLocaleString()}` },
        { text: signedN(w.delta), color: upColor(w.delta) },
      ],
    };
  }
  return {
    label, value: c.done.toLocaleString(), unit: `/ ${c.total.toLocaleString()}`,
    sub: `${c.pct}% complete`, tone: c.total === 0 ? "default" : pctTone(c.pct),
    lines: [{ text: split }],
  };
}

// Stats Health: the direct query hit the Supabase 1000-row cap and used a
// different tracked/played definition than the Stats Health site (which pulls
// "games played" from an external API and windows games from 2026-05-04). Until
// we read from that app's own KPI feed (like Feedback / Promo / Overdue), fall
// back to the sample card rather than show wrong live numbers.
// Stats Health reads the app's OWN KPI feed (same paginated card math +
// scheduledPlayedCount), so the numbers match its site exactly. Null -> sample.
async function loadStatsTiles(season: string, scope: Scope, week?: string): Promise<Tile[] | null> {
  try {
    const url = new URL("/api/dashboard-kpis", "https://brodie-stats-health.vercel.app");
    url.searchParams.set("season", season);
    if (week) url.searchParams.set("week", week);
    const lp = locParam(scope.locationNames); if (lp) url.searchParams.set("location", lp);
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as {
      stats_completion_pct: number | null; stats_completion_tone?: Tone; full_recording_tone?: Tone; games_played: number | null; games_tracked: number;
      by_source: { ballertv: number; livebarn: number; scoresheet: number }; no_stats: number;
      full_recording_pct: number | null; full: number; incomplete: number; recording_total: number;
      spare_appearances: number; spare_games: number;
      stat_delivery_ms: number | null; stat_delivery_n: number;
      forfeits?: number; pending_review?: number; prev_forfeits?: number | null;
      prev_stats_completion_pct?: number | null;
      prev_full_recording_pct?: number | null;
      prev_stat_delivery_ms?: number | null;
    };
    const n = (x: number) => x.toLocaleString();
    // Week-over-week rows: the previous week's value, then the delta. Present
    // only in Weekly Review, where the endpoint gets a week to compare against.
    const wowPct = (cur: number | null, prev: number | null | undefined) => {
      if (prev == null || cur == null) return [];
      const d = Math.round((cur - prev) * 10) / 10;
      return [
        { text: `prev week ${prev}%` },
        { text: `${d > 0 ? "+" : ""}${d} pts`, color: upColor(d) },
      ];
    };
    // Faster delivery is better, so a shorter time is the "up" direction.
    const wowElapsed = (cur: number | null, prev: number | null | undefined) => {
      if (prev == null || cur == null) return [];
      const d = cur - prev;
      return [
        { text: `prev week ${fmtElapsed(prev)}` },
        { text: `${d > 0 ? "+" : d < 0 ? "−" : ""}${fmtElapsed(Math.abs(d))}`, color: upColor(-d) },
      ];
    };
    const completionLines: NonNullable<Tile["lines"]> = [];
    // Only show "games played" (external schedule count) when it's sane — it must
    // be >= tracked, since every tracked game was played.
    if (k.games_played != null && k.games_played >= k.games_tracked) {
      completionLines.push({ text: `${n(k.games_played)} — games played`, strong: true });
    }
    completionLines.push({ text: `${n(k.games_tracked)} — games tracked`, strong: true });
    completionLines.push({ text: `${n(k.by_source.ballertv)} — BallerTV` });
    completionLines.push({ text: `${n(k.by_source.livebarn)} — LiveBarn` });
    completionLines.push({ text: `${n(k.by_source.scoresheet)} — In-venue` });
    completionLines.push({ text: `${n(k.no_stats)} — No stats` });
    // Why played can exceed tracked. A forfeit has no stats to collect, so it's
    // correctly outside the rate; a pending game just hasn't been reviewed yet,
    // and would otherwise vanish from the card entirely.
    if (k.pending_review) completionLines.push({ text: `${n(k.pending_review)} — not yet reviewed`, color: "var(--glass-gold)" });
    // Forfeits move to the card's right-hand headline, so they aren't a line.
    const fDelta = k.forfeits != null && k.prev_forfeits != null ? k.forfeits - k.prev_forfeits : null;
    const forfeitCorner = k.forfeits == null ? undefined : {
      label: "Forfeits",
      value: n(k.forfeits),
      // Fewer forfeits is better, so the delta's colours invert.
      lines: [
        ...(k.prev_forfeits != null ? [{ text: `prev week ${n(k.prev_forfeits)}` }] : []),
        ...(fDelta != null ? [{ text: `${fDelta > 0 ? "+" : ""}${fDelta}`, color: upColor(-fDelta) }] : []),
      ],
    };
    return [
      {
        label: "Stats completion rate", value: k.stats_completion_pct == null ? "—" : `${k.stats_completion_pct}%`,
        tone: k.stats_completion_tone ?? (k.stats_completion_pct == null ? "default" : pctTone(k.stats_completion_pct)),
        corner: forfeitCorner,
        // The rate's own week-over-week rows lead, so they sit level with the
        // forfeit comparison on the right of the same card.
        lines: [...wowPct(k.stats_completion_pct, k.prev_stats_completion_pct), ...completionLines],
      },
      {
        label: "Full recording %", value: k.full_recording_pct == null ? "—" : `${k.full_recording_pct}%`,
        tone: k.full_recording_tone ?? (k.full_recording_pct == null ? "default" : pctTone(k.full_recording_pct)),
        lines: [
          { text: `${n(k.full)} — full` },
          { text: `${n(k.incomplete)} — incomplete` },
          { text: `${n(k.recording_total)} — total` },
          ...wowPct(k.full_recording_pct, k.prev_full_recording_pct),
        ],
      },
      {
        label: "Spare players", value: n(k.spare_appearances), tone: k.spare_appearances > 0 ? "warn" : "default",
        lines: [
          { text: `${n(k.spare_games)} — games with spares` },
          { text: `${n(k.spare_appearances)} — spare appearances` },
        ],
        link: { href: "https://brodie-stats-health.vercel.app", label: "See games with spares →" },
      },
      {
        label: "Stat delivery time", value: k.stat_delivery_ms == null ? "—" : fmtElapsed(k.stat_delivery_ms),
        tone: "default",
        lines: [
          { text: `${n(k.stat_delivery_n)} games processed` },
          ...wowElapsed(k.stat_delivery_ms, k.prev_stat_delivery_ms),
        ],
      },
    ];
  } catch {
    return null;
  }
}

// Overdue Payments reads that app's OWN public KPI feed. When a location is
// selected only its currency has players, so only that currency card renders.
// Overdue reads the app's OWN checkin-stats feed (season-scoped), which computes
// the "active" = checked-in breakdown (owed by players who played a completed
// game that season). Amount-first currency labels; a location selected shows
// only that location's currency (the other has no players).
type CurTotals = { total_players: number; total_balance: number; active_players: number; active_balance: number; bad_debt: number };
async function loadOverdueTiles(season: string, scope: Scope): Promise<Tile[] | null> {
  try {
    const url = new URL("/api/checkin-stats", "https://brodie-overdue-payments.vercel.app");
    url.searchParams.set("season", season);
    const lp = locParam(scope.locationNames); if (lp) url.searchParams.set("location", lp);
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as {
      currency_totals?: { cad: CurTotals; usd: CurTotals };
      overall?: { total_players: number; active_players: number; locations: number };
      prev?: {
        as_of: string; total_players: number;
        cad: { total_players: number; total_balance: number; active_players: number; active_balance: number };
        usd: { total_players: number; total_balance: number; active_players: number; active_balance: number };
      } | null;
    };
    if (!k.currency_totals || !k.overall) return null; // pre-deploy shape -> sample
    const ov = k.overall;
    const money = (n: number, cur: string) =>
      `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
    // Owing less is an improvement, so these deltas run the other way.
    const wowCount = (cur: number, prev?: number) =>
      prev == null ? [] : [
        { text: `prev week ${prev.toLocaleString()}` },
        { text: `${cur - prev > 0 ? "+" : ""}${(cur - prev).toLocaleString()}`, color: upColor(-(cur - prev)) },
      ];
    // Compare what is still collectable — active players and their balance —
    // rather than the headline total, which includes people who have stopped
    // showing up. Owing less is an improvement, so the deltas run the other way.
    const wowActive = (
      c: CurTotals, cur: string,
      prev: { active_players: number; active_balance: number; total_players: number } | undefined,
    ) => {
      if (!prev) return [];
      const dBal = Math.round((c.active_balance - prev.active_balance) * 100) / 100;
      const dAct = c.active_players - prev.active_players;
      return [
        { text: `prev week ${prev.active_players} of ${prev.total_players} active · ${money(prev.active_balance, cur)}` },
        {
          text: `${dAct > 0 ? "+" : ""}${dAct} active · ${dBal > 0 ? "+" : dBal < 0 ? "−" : ""}${money(Math.abs(dBal), cur)}`,
          color: upColor(-dBal),
        },
      ];
    };
    const tiles: Tile[] = [
      {
        label: "Total overdue players", value: ov.total_players.toLocaleString(), tone: ov.total_players > 0 ? "bad" : "ok",
        lines: [
          { text: `${ov.active_players.toLocaleString()} of ${ov.total_players.toLocaleString()} active`, strong: true },
          { text: `across ${ov.locations} location${ov.locations === 1 ? "" : "s"}` },
          ...wowCount(ov.total_players, k.prev?.total_players),
        ],
      },
    ];
    const card = (c: CurTotals, cur: string, label: string, prev?: { total_players: number; total_balance: number; active_players: number; active_balance: number }): Tile | null =>
      c.total_players === 0 ? null : {
        label, value: money(c.total_balance, cur),
        lines: [
          { text: `${c.total_players} player${c.total_players === 1 ? "" : "s"}`, strong: true },
          { text: `${money(c.active_balance, cur)} from active players` },
          { text: `${c.active_players} of ${c.total_players} players active` },
          ...wowActive(c, cur, prev),
        ],
      };
    const cad = card(k.currency_totals.cad, "CAD", "Overdue Balance - Canadian Locations", k.prev?.cad);
    const usd = card(k.currency_totals.usd, "USD", "Overdue Balance - US Locations", k.prev?.usd);
    if (cad) tiles.push(cad);
    if (usd) tiles.push(usd);
    return tiles;
  } catch {
    return null;
  }
}

// Promo reads the Promo Tracker's OWN public KPI feed, so the numbers match its
// website exactly (no re-derivation here). Returns null on any failure -> sample.
// Add whole days to a "YYYY-MM-DD" string (UTC-safe, no tz drift).
function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// CRM outreach: touches (outbound messages) and notes, per league manager.
// Mirrors the CRM's own leaderboard definitions — a touch is an outbound
// activity on any channel except 'note'; a note is a 'note' activity. The CRM
// credits a row to both manager_id and actor_manager_id, which double-counts
// when they differ; here each activity is credited once, to whoever performed
// it, so the per-manager rows always sum to the headline total.
type TouchRow = { manager: string; touches: number; notes: number };
type TouchData = { touches: number; notes: number; rows: TouchRow[] };
async function loadTouchData(
  scope: Scope,
  opts: { fromIso?: string; toIso?: string; season?: string; weekLabel?: string },
): Promise<(TouchData & { label: string }) | null> {
  if (!sourceConfigured("crm")) return null;
  try {
    const sb = sourceClient("crm")!;

    // Window. A week beats a season when both are given (Weekly Review). For a
    // season, the CRM's own registry supplies the recruiting window; seasons
    // with no registration_start recorded can't be bounded, so those read all
    // time rather than inventing a range.
    let fromIso = opts.fromIso, toIso = opts.toIso;
    let label = opts.weekLabel ?? (fromIso ? "selected week" : "all time");
    if (!fromIso && opts.season) {
      const { data: seas } = await sb.from("seasons").select("key, p1_name, ordinal, registration_start");
      const rows = ((seas ?? []) as { key: string; p1_name: string | null; ordinal: number; registration_start: string | null }[])
        .sort((a, b) => a.ordinal - b.ordinal);
      const hit = rows.find((s) => seasonKey(s.p1_name ?? s.key) === seasonKey(opts.season!));
      if (hit?.registration_start) {
        fromIso = hit.registration_start;
        const next = rows.find((s) => s.ordinal > hit.ordinal && s.registration_start);
        toIso = next?.registration_start ?? undefined;
        label = `${opts.season} registration`;
      } else {
        label = "all time";
      }
    }

    // Scope to the filtered locations via the lead each activity is against.
    let leadIds: string[] | null = null;
    if (scope.locationNames) {
      if (!scope.locationNames.length) return { touches: 0, notes: 0, rows: [], label };
      const { data: locs } = await sb.from("locations").select("id, name");
      const wanted = ((locs ?? []) as { id: string; name: string }[])
        .filter((l) => scope.locationNames!.some((n) => sameLocation(n, l.name)))
        .map((l) => l.id);
      if (!wanted.length) return { touches: 0, notes: 0, rows: [], label };
      const ids: string[] = [];
      for (let from = 0; ; from += 1000) {
        const { data } = await sb.from("leads").select("id").in("location_id", wanted).order("id").range(from, from + 999);
        const page = (data ?? []) as { id: string }[];
        ids.push(...page.map((l) => l.id));
        if (page.length < 1000) break;
      }
      if (!ids.length) return { touches: 0, notes: 0, rows: [], label };
      leadIds = ids;
    }

    const { data: mgrs } = await sb.from("managers").select("id, name");
    const nameById = new Map(((mgrs ?? []) as { id: string; name: string }[]).map((m) => [m.id, m.name]));

    type Row = { manager_id: string | null; actor_manager_id: string | null; source?: string | null; body?: string | null };
    // One paginated read, optionally chunked over the scoped lead ids because
    // a location filter can select more than a single .in() list should carry.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    async function read(cols: string, apply: (q: any) => any): Promise<Row[]> {
      const out: Row[] = [];
      const chunks: (string[] | null)[] = leadIds
        ? Array.from({ length: Math.ceil(leadIds.length / 200) }, (_, i) => leadIds!.slice(i * 200, i * 200 + 200))
        : [null];
      for (const chunk of chunks) {
        for (let from = 0; from < 200000; from += 1000) {
          let q = apply(sb.from("activities").select(cols));
          if (fromIso) q = q.gte("occurred_at", fromIso);
          if (toIso) q = q.lt("occurred_at", toIso);
          if (chunk) q = q.in("lead_id", chunk);
          const { data, error } = await q.order("id").range(from, from + 999);
          if (error || !data) break;
          out.push(...(data as unknown as Row[]));
          if (data.length < 1000) break;
        }
      }
      return out;
    }

    const [touchRows, noteRowsRaw] = await Promise.all([
      read("manager_id, actor_manager_id", (q) => q.eq("direction", "outbound").neq("channel", "note")),
      read("manager_id, actor_manager_id, source, body", (q) => q.eq("channel", "note")),
    ]);

    // A note is LM insight, not machine chatter — the same exclusions the CRM's
    // own notes feed applies (p1_reconcile reconciliation rows and [STAGE]
    // kanban audit entries were ~1,700 of the total).
    const noteRows = noteRowsRaw.filter((r) => {
      const body = (r.body ?? "").trim();
      if (!body) return false;
      if ((r.source ?? "") === "p1_reconcile") return false;
      if (body.startsWith("Name reconciled from Player One")) return false;
      if (body.startsWith("[STAGE]")) return false;
      return true;
    });

    const byMgr = new Map<string, { touches: number; notes: number }>();
    const credit = (r: Row, kind: "touches" | "notes") => {
      const who = r.actor_manager_id ?? r.manager_id;
      const key = (who && nameById.get(who)) || "Unassigned";
      const cur = byMgr.get(key) ?? { touches: 0, notes: 0 };
      cur[kind]++;
      byMgr.set(key, cur);
    };
    for (const r of touchRows) credit(r, "touches");
    for (const r of noteRows) credit(r, "notes");

    return {
      touches: touchRows.length,
      notes: noteRows.length,
      rows: [...byMgr.entries()].map(([manager, v]) => ({ manager, ...v })),
      label,
    };
  } catch {
    return null;
  }
}

// Training reads the training app's OWN module-rollup feed, so the numbers
// match its Reports page exactly (role-based + explicit assignment, minus
// exclusions, expiry-aware). Null -> the section is left off.
type ModuleRollup = {
  slug: string; title: string; assigned: number; certified: number;
  not_certified: number; expired: number; overdue: number; completion_pct: number | null;
};
// The four playbooks the dashboard tracks, in the order they should read.
const TRAINING_MODULES = [
  "League Manager Playbook",
  "AES Playbook",
  "AHS Playbook",
  "Scorekeeper Playbook",
];
async function loadTrainingTiles(scope: Scope): Promise<Tile[] | null> {
  try {
    const url = new URL("/api/dashboard-kpis", "https://brodie-training.vercel.app");
    const lp = locParam(scope.locationNames); if (lp) url.searchParams.set("location", lp);
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as { modules?: ModuleRollup[] };
    const byTitle = new Map((k.modules ?? []).map((m) => [m.title.toLowerCase(), m]));
    const tiles: Tile[] = [];
    for (const title of TRAINING_MODULES) {
      const m = byTitle.get(title.toLowerCase());
      if (!m) continue;
      const pct = m.completion_pct;
      tiles.push({
        label: title.replace(/ Playbook$/, ""),
        value: pct == null ? "—" : `${pct}%`,
        tone: pct == null ? "default" : pctTone(pct),
        sub: `${m.certified} of ${m.assigned} certified`,
        lines: [
          { text: `${m.not_certified} — not certified` },
          ...(m.expired ? [{ text: `${m.expired} — expired` }] : []),
          ...(m.overdue ? [{ text: `${m.overdue} — overdue`, color: "rgb(248,113,113)" }] : []),
        ],
      });
    }
    return tiles.length ? tiles : null;
  } catch {
    return null;
  }
}

async function loadPromoTiles(season: string, scope: Scope): Promise<{ tiles: Tile[]; teamsRegistered: number } | null> {
  try {
    const url = new URL("/api/dashboard-kpis", "https://registration-promo-tracker.vercel.app");
    url.searchParams.set("season", season);
    const lp = locParam(scope.locationNames); if (lp) url.searchParams.set("location", lp);
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (res.status === 404) {
      // Season is beyond the promo horizon — registration hasn't opened.
      const zero: Tile[] = [
        { label: "Teams registered", value: "0", sub: `${season} — registration not open yet` },
        { label: "Stories posted", value: "0", unit: "/ 0", sub: "0%" },
        { label: "Highlights posted", value: "0", unit: "/ 0", sub: "0%" },
        { label: "Avg time to post", value: "—", sub: "0 posts" },
      ].map((x) => x) as Tile[];
      return { tiles: zero, teamsRegistered: 0 };
    }
    if (!res.ok) return null;
    const k = (await res.json()) as {
      teams_registered: number; stories_posted: number; highlights_posted: number;
      story_pct: number; highlight_pct: number; story_tone?: Tone; highlight_tone?: Tone; avg_time_to_post_ms: number | null;
      avg_time_to_post_sample: number; locations: number;
    };
    const fmt = (ms: number) => {
      const m = Math.floor(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
      return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${mm}m` : `${mm}m`;
    };
    const tiles: Tile[] = [
      { label: "Teams registered", value: k.teams_registered.toLocaleString(), sub: `across ${k.locations} locations` },
      { label: "Stories posted", value: `${k.stories_posted}`, unit: `/ ${k.teams_registered}`, sub: `${k.story_pct}%`, tone: k.story_tone ?? pctTone(k.story_pct) },
      { label: "Highlights posted", value: `${k.highlights_posted}`, unit: `/ ${k.teams_registered}`, sub: `${k.highlight_pct}%`, tone: k.highlight_tone ?? pctTone(k.highlight_pct) },
      { label: "Avg time to post", value: k.avg_time_to_post_ms != null ? fmt(k.avg_time_to_post_ms) : "—", sub: `${k.avg_time_to_post_sample} posts`, tone: "warn" },
    ];
    return { tiles, teamsRegistered: k.teams_registered };
  } catch {
    return null;
  }
}

// Registration pacing (teams + athletes at "day N of registration" for this
// season vs the previous season vs a year ago) from the Promo Tracker feed.
type PacingSeason = { season: string; kind: string; captains: number; athletes: number };
type Retention = { pct: number; prev_athletes: number; retained: number; prev_season: string };
type PacingLocation = { location: string; seasons: PacingSeason[]; retention?: Retention | null };
type Pacing = { day_n: number | null; seasons: PacingSeason[]; locations?: PacingLocation[] };
async function loadRegistrationPacing(regSeason: string, scope: Scope, week?: string): Promise<Pacing | null> {
  try {
    const url = new URL("/api/registration-pacing", "https://registration-promo-tracker.vercel.app");
    url.searchParams.set("season", regSeason);
    url.searchParams.set("breakdown", "location");
    if (week) url.searchParams.set("week", week);
    const lp = locParam(scope.locationNames); if (lp) url.searchParams.set("location", lp);
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as Pacing;
    return k.seasons?.length ? k : null;
  } catch {
    return null;
  }
}

type SiteVisitWeek = {
  week_start: string; label: string; count: number;
  avg_score: number | null; avg_tone: Tone;
  prev_count: number; prev_avg: number | null; count_delta: number; avg_delta: number | null;
  visits: { location: string; score: number | null; date: string; day: string; dm: string }[];
};
type SiteVisitsData = {
  weeks: SiteVisitWeek[];
  by_dm: { dm: string; count: number; avg_score: number | null; avg_tone: Tone; prev_count: number; delta: number }[];
};
async function loadSiteVisits(scope: Scope, week?: string): Promise<SiteVisitsData | null> {
  try {
    const url = new URL("/api/site-visits-weekly", "https://brodie-feedback.vercel.app");
    if (week) url.searchParams.set("week", week);
    const lp = locParam(scope.locationNames); if (lp) url.searchParams.set("location", lp);
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as SiteVisitsData;
    return { weeks: k.weeks ?? [], by_dm: k.by_dm ?? [] };
  } catch {
    return null;
  }
}

// Counts report reviews completed out of the nights that ran; the unreviewed
// nights are named individually so the gap is visible at a glance.
type VideoReviewWeek = {
  week_start: string; label: string;
  nights: number; prev_nights: number;
  reviewed: number; prev_reviewed: number; reviewed_delta: number;
  missing: number;
  missing_list: { location: string; date: string; day: string }[];
};
type VideoReviewsData = {
  weeks: VideoReviewWeek[];
  by_location: { location: string; completed: number; nights: number; prev_completed: number; delta: number }[];
};
async function loadVideoReviews(scope: Scope, week?: string): Promise<VideoReviewsData | null> {
  try {
    const url = new URL("/api/video-reviews-weekly", "https://brodie-feedback.vercel.app");
    if (week) url.searchParams.set("week", week);
    const lp = locParam(scope.locationNames); if (lp) url.searchParams.set("location", lp);
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as VideoReviewsData;
    return { weeks: k.weeks ?? [], by_location: k.by_location ?? [] };
  } catch {
    return null;
  }
}

const KIND_LABEL: Record<string, string> = { current: "this season", prev_season: "prev season", prev_year: "last year" };
const REG_COLOR: Record<string, string> = { current: "var(--glass-gold)", prev_season: "#5B8AC4", prev_year: "#A874C9" };
const TRACK_PX = 130;
function RegBarCard({ title, subtitle, current, bars }: {
  title: string; subtitle: string; current: number;
  bars: { label: string; sub: string; value: number; color: string }[];
}) {
  const max = Math.max(...bars.map((b) => b.value), 1);
  return (
    <div className="rounded-2xl border border-glass-border bg-glass-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold" style={{ color: "var(--glass-text)" }}>{title}</h3>
          <p className="text-xs mt-0.5 text-glass-text-tertiary">{subtitle}</p>
        </div>
        <span className="text-2xl font-bold tabular" style={{ color: "var(--glass-gold)" }}>{current.toLocaleString()}</span>
      </div>
      {/* Bars: fixed-px track so heights are truly proportional to value. */}
      <div className="flex items-end gap-6 mt-5" style={{ height: TRACK_PX + 22 }}>
        {bars.map((b, i) => (
          <div key={i} className="flex-1 flex flex-col items-center justify-end">
            <span className="text-sm font-semibold mb-1" style={{ color: "var(--glass-text)" }}>{b.value.toLocaleString()}</span>
            <div className="w-full rounded-t-md" style={{ height: Math.max(Math.round((b.value / max) * TRACK_PX), 6), background: b.color }} />
          </div>
        ))}
      </div>
      <div className="flex gap-6 mt-2">
        {bars.map((b, i) => (
          <div key={i} className="flex-1 flex flex-col items-center">
            <span className="text-[11px] font-semibold text-glass-text-secondary">{b.label}</span>
            <span className="text-[10px] uppercase tracking-wider text-glass-text-tertiary">{b.sub}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Difference vs a comparison season at the same day of registration. Green =
// ahead of that season's pace, red = behind. null when the feed is missing a side.
function RegDeltaCard({ title, subtitle, delta }: {
  title: string; subtitle: string; delta: number | null;
}) {
  const color =
    delta === null || delta === 0 ? "var(--glass-text)" :
    delta > 0 ? "rgb(74,222,128)" : "rgb(248,113,113)";
  return (
    <div className="rounded-2xl border border-glass-border bg-glass-surface p-4">
      <h3 className="text-sm font-semibold" style={{ color: "var(--glass-text)" }}>{title}</h3>
      <p className="text-[11px] mt-0.5 text-glass-text-tertiary">{subtitle}</p>
      <p className="text-3xl font-bold tabular mt-2" style={{ color }}>
        {delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta.toLocaleString()}`}
      </p>
    </div>
  );
}

const deltaColor = (d: number) =>
  d === 0 ? "var(--glass-text-secondary)" : d > 0 ? "rgb(74,222,128)" : "rgb(248,113,113)";
const signed = (d: number) => `${d > 0 ? "+" : ""}${d.toLocaleString()}`;

// One metric column inside a location card: count + both same-day deltas.
function LocationMetric({ label, cur, prev, year, prevLabel, yearLabel }: {
  label: string; cur: number; prev: number; year: number; prevLabel: string; yearLabel: string;
}) {
  const dPrev = cur - prev, dYear = cur - year;
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-glass-text-tertiary">{label}</p>
      <p className="text-2xl font-bold tabular leading-tight" style={{ color: "var(--glass-text)" }}>{cur.toLocaleString()}</p>
      <p className="text-[11px] font-semibold mt-1" style={{ color: deltaColor(dPrev) }}>
        {signed(dPrev)} <span className="font-normal text-glass-text-tertiary">vs {prevLabel}</span>
      </p>
      <p className="text-[11px] font-semibold" style={{ color: deltaColor(dYear) }}>
        {signed(dYear)} <span className="font-normal text-glass-text-tertiary">vs {yearLabel}</span>
      </p>
    </div>
  );
}

// Horizontally scrolling strip of per-location cards. Each card carries both
// teams and athletes so a location reads as one unit instead of forcing you to
// scroll two rows in sync to compare them.
function LocationStrip({ locations, prevLabel, yearLabel, season, showAvgPerTeam = true }: {
  locations: PacingLocation[];
  prevLabel: string;
  yearLabel: string;
  season: string;
  // Athletes-per-team is a roster size, which only holds season-to-date. On a
  // week basis the two sides count different cohorts — athletes who joined a
  // team registered in an earlier week — so the ratio is left off.
  showAvgPerTeam?: boolean;
}) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-glass-text-tertiary mb-2">By location</h3>
      <div className="flex gap-3 overflow-x-auto pb-2 snap-x">
        {locations.map((l) => {
          const get = (kind: string, metric: "captains" | "athletes") =>
            l.seasons.find((s) => s.kind === kind)?.[metric] ?? 0;
          const curTeams = get("current", "captains");
          const avgPerTeam = curTeams ? get("current", "athletes") / curTeams : null;
          // >= 8.5 green, >= 7.5 yellow, below red.
          const avgColor =
            avgPerTeam === null ? "var(--glass-text-secondary)"
              : avgPerTeam >= 8.5 ? "rgb(74,222,128)"
                : avgPerTeam >= 7.5 ? "var(--glass-gold)"
                  : "rgb(248,113,113)";
          return (
            <div key={l.location}
              className="snap-start shrink-0 w-[232px] rounded-xl border border-glass-border bg-glass-surface p-3.5">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-xs font-semibold truncate" style={{ color: "var(--glass-text)" }} title={l.location}>
                  {l.location}
                </p>
                {showAvgPerTeam && (
                  <p className="text-xs font-semibold tabular shrink-0" title="Average athletes per team"
                    style={{ color: avgColor }}>
                    {avgPerTeam === null ? "—" : avgPerTeam.toFixed(1)}
                    <span className="font-normal text-glass-text-tertiary"> / team</span>
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 mt-2.5">
                <LocationMetric label="Teams"
                  cur={get("current", "captains")} prev={get("prev_season", "captains")} year={get("prev_year", "captains")}
                  prevLabel={prevLabel} yearLabel={yearLabel} />
                <LocationMetric label="Athletes"
                  cur={get("current", "athletes")} prev={get("prev_season", "athletes")} year={get("prev_year", "athletes")}
                  prevLabel={prevLabel} yearLabel={yearLabel} />
              </div>
              <div className="mt-3 flex items-end justify-between gap-2">
                {l.retention ? (
                  <span className="text-[11px] leading-tight" title={`${l.retention.retained} of ${l.retention.prev_athletes} ${prevLabel} athletes registered again this season`}>
                    <span className="font-semibold" style={{ color: "var(--glass-text-secondary)" }}>{l.retention.pct}%</span>
                    <span className="text-glass-text-tertiary"> retained vs {prevLabel}</span>
                  </span>
                ) : <span />}
                <a href={`/registrations/location?loc=${encodeURIComponent(l.location)}&season=${encodeURIComponent(season)}`}
                  className="text-[11px] font-semibold hover:brightness-110 transition shrink-0" style={{ color: "var(--glass-gold)" }}>
                  More details →
                </a>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Saturday-Friday weeks for the Weekly Review filter. Value = the Saturday
// (YYYY-MM-DD); most recent first.
const WK_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function weekOptions(count = 16): { value: string; label: string }[] {
  const now = new Date();
  const sat = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  sat.setUTCDate(sat.getUTCDate() - ((sat.getUTCDay() - 6 + 7) % 7));
  const out: { value: string; label: string }[] = [];
  for (let i = 0; i < count; i++) {
    const s = new Date(sat); s.setUTCDate(s.getUTCDate() - 7 * i);
    const f = new Date(s); f.setUTCDate(f.getUTCDate() + 6);
    out.push({
      value: s.toISOString().slice(0, 10),
      label: `${WK_MON[s.getUTCMonth()]} ${s.getUTCDate()} – ${WK_MON[f.getUTCMonth()]} ${f.getUTCDate()}`,
    });
  }
  return out;
}

export default async function DashboardView({
  searchParams,
  mode = "full",
}: {
  searchParams: Promise<{ season?: string; location?: string; lm?: string; week?: string; regBasis?: string }>;
  mode?: "full" | "registrations" | "weekly";
}) {
  await requireUser();
  const isReg = mode === "registrations";
  const isWeekly = mode === "weekly";
  const { season: seasonParam, location: locationParam, week: weekParam, regBasis } = await searchParams;
  // Every filter accepts a comma-separated list, so several seasons, weeks,
  // locations and league managers can be selected at once.
  const csv = (v?: string) => (v ?? "").split(",").map((s) => s.trim()).filter((s) => s && s !== "all");
  const selectedSeasons = csv(seasonParam);
  const selectedLocations = csv(locationParam).map(canonicalLocation);
  // Weekly Review: resolve the selected Saturday-Friday weeks (default = current).
  const weeks = isWeekly ? weekOptions() : [];
  const selectedWeeks = isWeekly
    ? csv(weekParam).filter((w) => weeks.some((o) => o.value === w))
    : [];
  // The primary week drives WoW comparisons and the header label; extra weeks
  // widen the window each week-scoped section aggregates over.
  // Default to the LAST COMPLETE week, not the one in progress — a review of a
  // week that is still running would read as a shortfall every time. weeks[0]
  // is the current week, so weeks[1] is the one just finished; it stays
  // selectable in the list either way.
  const defaultWeek = weeks[1]?.value ?? weeks[0]?.value;
  const activeWeeks = isWeekly ? (selectedWeeks.length ? selectedWeeks : [defaultWeek].filter(Boolean) as string[]) : [];
  const week = activeWeeks[0];
  const weekLabel = activeWeeks.length > 1
    ? `${activeWeeks.length} weeks`
    : (weeks.find((w) => w.value === week)?.label ?? "");
  // Weekly Review reads the registration cards season-to-date by default; the
  // toggle switches them to the selected week. Ignored on other tabs.
  const regOnWeek = isWeekly && regBasis === "week";
  const admin = createAdminClient();

  const { data: latest } = await admin
    .from("daily_snapshots")
    .select("snapshot_date")
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const snapDate: string | null = latest?.snapshot_date ?? null;

  const activeLMs = await loadActiveLMs();
  // On the Dashboard the filter picks the PLAYING season and the Registrations
  // card reports one ahead of it (tagged), because the other sections' data
  // lives in the playing season. The Registrations tab has nothing else on it,
  // so there the filter picks the registration season directly — selecting
  // Fall '26 shows Fall '26 rather than silently reporting the season after.
  const { promoLocations, promoSeasons, selectedSeason, regSeason, locationNames } = await resolveScope(
    { season: selectedSeasons[0], locations: selectedLocations },
    { defaultSeason: isReg ? "registration" : "playing" },
  );
  const pacingSeason = isReg ? selectedSeason : regSeason;

  // Live, season + location/LM scoped section cards (fall back to sample if unwired).
  const scope: Scope = { locationNames };
  // Sections whose source app aggregates over several seasons/weeks get the
  // whole selection; the rest use the primary one. Registration pacing keeps a
  // single week because its window is offset-aligned to each season's start,
  // so a union of calendar weeks has no meaning there.
  const seasonsParam = selectedSeasons.length ? selectedSeasons.join(",") : selectedSeason;
  // Outreach window: the selected week(s) on Weekly Review, else everything.
  const touchFrom = activeWeeks.length ? `${activeWeeks[0]}T00:00:00Z` : undefined;
  const touchTo = activeWeeks.length
    ? `${addDaysIso(activeWeeks[activeWeeks.length - 1], 7)}T00:00:00Z`
    : undefined;
  const touchWhen = activeWeeks.length ? `week of ${weekLabel}` : "all time";
  const weeksParam = activeWeeks.length ? activeWeeks.join(",") : undefined;
  // Registrations mode shows only the Registrations section, so skip the other
  // source loads entirely — just fetch pacing.
  const [ckCurrent, ckNext, feedbackTiles, statsTiles, contentTiles, promoTiles, overdueTiles, pacing, touchData, trainingTiles, bookings, siteVisits, videoReviews] = await Promise.all([
    isReg ? Promise.resolve(null) : loadChecklistTiles(selectedSeason, scope, promoLocations),
    isReg ? Promise.resolve(null) : loadChecklistTiles(regSeason, scope, promoLocations),
    isReg ? Promise.resolve(null) : loadFeedbackTiles(selectedSeason, scope),
    isReg ? Promise.resolve(null) : loadStatsTiles(seasonsParam, scope, weeksParam),
    isReg ? Promise.resolve(null) : loadContentTiles(seasonsParam, scope, weeksParam),
    isReg ? Promise.resolve(null) : loadPromoTiles(regSeason, scope),
    isReg ? Promise.resolve(null) : loadOverdueTiles(selectedSeason, scope),
    loadRegistrationPacing(pacingSeason, scope, regOnWeek ? week : undefined),
    isReg ? Promise.resolve(null) : loadTouchData(scope, { fromIso: touchFrom, toIso: touchTo, season: regSeason, weekLabel: activeWeeks.length ? `week of ${weekLabel}` : undefined }),
    isReg ? Promise.resolve(null) : loadTrainingTiles(scope),
    isReg ? Promise.resolve(null) : loadBookings(regSeason, scope),
    isReg ? Promise.resolve(null) : loadSiteVisits(scope, weeksParam),
    isReg ? Promise.resolve(null) : loadVideoReviews(scope, weeksParam),
  ]);
  const pacingCurrent = pacing?.seasons.find((s) => s.kind === "current");
  const pacingPrevSeason = pacing?.seasons.find((s) => s.kind === "prev_season");
  const pacingPrevYear = pacing?.seasons.find((s) => s.kind === "prev_year");
  // Same-day difference: current season minus the comparison season at day N.
  const regDelta = (metric: "captains" | "athletes", against: typeof pacingPrevSeason) =>
    pacingCurrent && against ? pacingCurrent[metric] - against[metric] : null;
  const regBars = (metric: "captains" | "athletes") =>
    (pacing?.seasons ?? []).map((s) => ({ label: s.season, sub: KIND_LABEL[s.kind] ?? s.kind, value: s[metric], color: REG_COLOR[s.kind] ?? "var(--glass-border-light)" }));
  // Checklist: two cards for the playing season, two for the next (prep) season.
  const checklistTiles = ckCurrent && ckNext ? [...ckCurrent, ...ckNext] : (ckCurrent ?? null);

  const snaps: SnapRow[] = snapDate
    ? (((await admin
        .from("daily_snapshots")
        .select("raw_value, lm_id, metrics!inner(name, slug), apps!inner(slug, name), league_managers!inner(id, full_name, location_name, active)")
        .eq("snapshot_date", snapDate)
      ).data) as unknown as SnapRow[]) ?? []
    : [];

  // Map the selected Promo Tracker locations to their roster names for matching.
  // A snapshot is in scope if it matches ANY selected location or league
  // manager (the same union the source-app queries use).
  const rosterLocations = new Set(selectedLocations.map((l) => PROMO_TO_ROSTER[l] ?? l));
  const filtered = snaps.filter((s) => {
    if (!s.league_managers?.active) return false;
    if (!rosterLocations.size) return true;
    const locName = s.league_managers.location_name;
    return locName != null && rosterLocations.has(locName);
  });

  type MetricAgg = { name: string; slug: string; sum: number; n: number };
  const byApp = new Map<string, { metrics: Map<string, MetricAgg>; lms: Set<string> }>();
  for (const s of filtered) {
    const appSlug = s.apps?.slug;
    if (!appSlug) continue;
    const app = byApp.get(appSlug) ?? { metrics: new Map(), lms: new Set() };
    app.lms.add(s.lm_id);
    if (s.raw_value != null) {
      const m = app.metrics.get(s.metrics.slug) ?? { name: s.metrics.name, slug: s.metrics.slug, sum: 0, n: 0 };
      m.sum += Number(s.raw_value);
      m.n += 1;
      app.metrics.set(s.metrics.slug, m);
    }
    byApp.set(appSlug, app);
  }
  const realTiles = (slug: string): Tile[] => {
    const app = byApp.get(slug);
    if (!app) return [];
    return Array.from(app.metrics.values()).map((m) => ({
      label: m.name,
      value: m.n ? fmt(m.slug, m.sum / m.n) : "—",
    }));
  };

  const options: FilterOptions = {
    seasons: promoSeasons.map((s) => ({ value: s, label: s })),
    locations: promoLocations,
    ...(isWeekly ? { weeks } : {}),
  };

  // Name the scope: one location reads by name, several read as a count, and
  // nothing selected means the whole league.
  const scopeLabel =
    selectedLocations.length === 1 ? selectedLocations[0]
    : selectedLocations.length ? `${selectedLocations.length} locations`
    : `all ${activeLMs.length} league managers`;

  // Registration section subtitles read by week in Weekly Review, by day-of-
  // registration otherwise.
  // Weekly Review mixes week-scoped and season-to-date sections, so each
  // heading says which it is. Blank everywhere else.
  const fullTag = isWeekly ? "(Full Season)" : "";
  const weekTag = isWeekly ? "(Weekly)" : "";

  const regBarWhen = regOnWeek ? `week of ${weekLabel}` : `day ${pacing?.day_n ?? "?"} of registration`;
  const regDeltaWhen = regOnWeek ? `week of ${weekLabel}` : `day ${pacing?.day_n ?? "?"}`;

  return (
    <main className="brodie-fade-in space-y-8">
      <header>
        <p className="font-mono text-xs uppercase tracking-[0.18em] mb-1" style={{ color: "var(--glass-gold)" }}>{isReg ? "Registrations" : isWeekly ? "Weekly review" : "Dashboard"}</p>
        <h1 className="text-3xl font-semibold tracking-tight" style={{ color: "var(--glass-text)" }}>{isReg ? "Registration pacing" : isWeekly ? "Weekly review" : "League overview"}</h1>
        <p className="text-sm mt-1 text-glass-text-secondary">
          {isReg
            ? <>Teams &amp; athletes at day N of registration for {scopeLabel}, vs the previous season and last year.</>
            : isWeekly
              ? <>Cross-app health for {scopeLabel}, scoped to the week of {weekLabel} (Sat–Fri). Registrations, Stats Health &amp; Content Health are week-scoped; other sections show the season to date.</>
              : <>Cross-app health for {scopeLabel}.{snapDate ? ` As of ${snapDate}.` : ""}</>}
        </p>
      </header>

      <Filters
        key={`${selectedSeasons.join(",")}|${activeWeeks.join(",")}|${selectedLocations.join(",")}`}
        options={options}
        current={{
          seasons: selectedSeasons.length ? selectedSeasons : [selectedSeason],
          locations: selectedLocations,
          ...(isWeekly ? { weeks: activeWeeks } : {}),
        }}
      />

      <div className="space-y-8">
        {!isReg && (
          <Section title="Season Success Checklist" scopeTag={fullTag} href={APP_URL.checklist} tiles={checklistTiles ?? SAMPLE.checklist} sample={!checklistTiles} cols={6} />
        )}
        {pacing && pacingCurrent ? (
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <h2 className="text-lg font-semibold" style={{ color: "var(--glass-text)" }}>Registrations</h2>
                <span className="text-[9px] uppercase tracking-[0.16em] font-bold px-1.5 py-0.5 rounded"
                  style={{ background: "var(--glass-gold-light, rgba(255,184,0,0.16))", color: "var(--glass-gold)" }}>{pacingSeason}</span>
                {isWeekly && (
                  <BasisToggle
                    param="regBasis"
                    value={regOnWeek ? "week" : "season"}
                    options={[{ value: "season", label: "Season" }, { value: "week", label: "Week" }]}
                  />
                )}
              </div>
              {/* Only on the Dashboard, where every section deep-links to its
                  source app. The Registrations tab is the detail view, so
                  sending people out to the Promo Tracker from it is a dead end. */}
              {!isReg && (
                <a href={APP_URL.promo} target="_blank" rel="noopener noreferrer"
                  className="text-xs font-semibold shrink-0 hover:brightness-110 transition" style={{ color: "var(--glass-gold)" }}>More details →</a>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <RegBarCard title="Total teams" subtitle={`captain registrations · ${regBarWhen}`} current={pacingCurrent.captains} bars={regBars("captains")} />
              <RegBarCard title="Total athletes" subtitle={`athlete registrations · ${regBarWhen}`} current={pacingCurrent.athletes} bars={regBars("athletes")} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <RegDeltaCard
                title="Teams vs prev season"
                subtitle={`${pacingCurrent.season} vs ${pacingPrevSeason?.season ?? "—"} · ${regDeltaWhen}`}
                delta={regDelta("captains", pacingPrevSeason)} />
              <RegDeltaCard
                title="Teams vs last year"
                subtitle={`${pacingCurrent.season} vs ${pacingPrevYear?.season ?? "—"} · ${regDeltaWhen}`}
                delta={regDelta("captains", pacingPrevYear)} />
              <RegDeltaCard
                title="Athletes vs prev season"
                subtitle={`${pacingCurrent.season} vs ${pacingPrevSeason?.season ?? "—"} · ${regDeltaWhen}`}
                delta={regDelta("athletes", pacingPrevSeason)} />
              <RegDeltaCard
                title="Athletes vs last year"
                subtitle={`${pacingCurrent.season} vs ${pacingPrevYear?.season ?? "—"} · ${regDeltaWhen}`}
                delta={regDelta("athletes", pacingPrevYear)} />
            </div>
            {pacing.locations?.length ? (
              <div className="pt-1">
                <LocationStrip
                  locations={pacing.locations}
                  prevLabel={shortSeason(pacingPrevSeason?.season ?? "")}
                  yearLabel={shortSeason(pacingPrevYear?.season ?? "")}
                  season={pacingCurrent.season}
                  showAvgPerTeam={!regOnWeek} />
              </div>
            ) : null}
          </section>
        ) : (
          <Section title="Registrations" href={APP_URL.crm} tiles={realTiles("crm")} seasonTag={pacingSeason} />
        )}
        {!isReg && (
          <>
            <Section title="Registration Promo Tracker" scopeTag={fullTag} href={APP_URL.promo} tiles={promoTiles?.tiles ?? SAMPLE.promo} sample={!promoTiles} seasonTag={regSeason} />
            <TouchesSection data={touchData} when={touchWhen} titleSuffix={weekTag} />
            {siteVisits && siteVisits.weeks.length > 0 && <SiteVisitsSection data={siteVisits} titleSuffix={weekTag} />}
            {videoReviews && videoReviews.weeks.length > 0 && <VideoReviewsSection data={videoReviews} titleSuffix={weekTag} />}
            {trainingTiles && <Section title="Training" scopeTag={fullTag} href={APP_URL.training} tiles={trainingTiles} />}
            <Section title="Stats Health" scopeTag={weekTag} href={APP_URL.stats_health} tiles={statsTiles ?? SAMPLE.stats_health} sample={!statsTiles} />
            <Section title="Content Health" scopeTag={weekTag} href={APP_URL.content_health} tiles={contentTiles ?? SAMPLE.content} sample={!contentTiles} />
            <Section title="Feedback" scopeTag={fullTag} href={APP_URL.feedback} tiles={feedbackTiles ?? SAMPLE.feedback} sample={!feedbackTiles} />
            <Section title="Overdue Payments" scopeTag={fullTag} href={APP_URL.overdue} tiles={overdueTiles ?? SAMPLE.overdue} sample={!overdueTiles} />
            {bookings && <BookingsSection data={bookings} season={regSeason} titleSuffix={fullTag} teamsRegistered={promoTiles?.teamsRegistered} />}
          </>
        )}
      </div>

      {!isReg && (
        <p className="text-xs text-glass-text-tertiary">
          Feedback, Stats Health, and Content Health read live from each source, scoped to the selected Season, Location,
          and League manager (locations reconciled across apps by fuzzy match). Registration + Promo run one season ahead
          (the prep season, tagged in gold), and the Checklist shows both. The Promo Tracker card reads live from the Promo
          Tracker&apos;s own KPI feed, so its numbers match that site exactly.
        </p>
      )}
    </main>
  );
}

const TONE_COLOR: Record<string, string> = {
  ok: "rgb(74,222,128)", warn: "var(--glass-gold)", bad: "rgb(248,113,113)", default: "var(--glass-text-secondary)",
};
const scoreTone = (s: number | null): string => TONE_COLOR[s == null ? "default" : s >= 80 ? "ok" : s >= 60 ? "warn" : "bad"];
// WoW deltas: more visits / higher score = green, fewer / lower = red.
const upColor = (n: number) => (n > 0 ? "rgb(74,222,128)" : n < 0 ? "rgb(248,113,113)" : "var(--glass-text-tertiary)");
const signedN = (n: number) => `${n > 0 ? "+" : ""}${n}`;
const SV_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// The Sat-Fri week before this week's Saturday, e.g. "Aug 1 – Aug 7".
function prevWeekLabel(sat: string): string {
  const s = new Date(sat + "T00:00:00Z"); s.setUTCDate(s.getUTCDate() - 7);
  const f = new Date(s); f.setUTCDate(f.getUTCDate() + 6);
  return `${SV_MON[s.getUTCMonth()]} ${s.getUTCDate()} – ${SV_MON[f.getUTCMonth()]} ${f.getUTCDate()}`;
}

// Site visits completed each Saturday–Friday week and their scores (from the
// Feedback app's site-visit scorecards).
// Two CRM outreach cards: the headline count, then every league manager who
// logged any, listed small underneath. Managers with none are left off.
function TouchesSection({ data, when, titleSuffix = "" }: { data: (TouchData & { label: string }) | null; when: string; titleSuffix?: string }) {
  const card = (
    title: string,
    total: number,
    pick: (r: TouchRow) => number,
  ) => {
    const rows = (data?.rows ?? []).filter((r) => pick(r) > 0)
      .sort((a, b) => pick(b) - pick(a) || a.manager.localeCompare(b.manager));
    const max = Math.max(...rows.map(pick), 1);
    return (
      <div className="rounded-xl border border-glass-border bg-glass-surface px-4 py-3.5 min-w-0">
        <div className="text-[10px] uppercase tracking-[0.16em] font-bold text-glass-text-tertiary">{title}</div>
        <div className="mt-1.5 flex items-baseline gap-2">
          <span className="text-2xl font-bold tabular" style={{ color: "var(--glass-gold)" }}>{total.toLocaleString()}</span>
          <span className="text-[11px] text-glass-text-tertiary">{data?.label ?? when}</span>
        </div>
        {rows.length === 0 ? (
          <div className="mt-2 text-[11px] italic text-glass-text-tertiary">
            {data ? "none logged" : "CRM feed unavailable"}
          </div>
        ) : (
          <div className="mt-2 space-y-1">
            {rows.map((r) => (
              <div key={r.manager} className="flex items-center gap-2">
                <span className="text-[11px] text-glass-text-secondary truncate flex-1 min-w-0">{r.manager}</span>
                {/* A bar makes the spread readable without a second column of numbers. */}
                <span className="h-1 rounded-full shrink-0" style={{ width: `${Math.round((pick(r) / max) * 56)}px`, background: "var(--glass-gold)", opacity: 0.5 }} />
                <span className="text-[11px] tabular font-semibold shrink-0" style={{ color: "var(--glass-text)" }}>{pick(r).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-lg font-semibold" style={{ color: "var(--glass-text)" }}>Outreach</h2>
          {titleSuffix && <span className="text-xs font-normal text-glass-text-tertiary">{titleSuffix}</span>}
        </div>
        <a href={APP_URL.crm} target="_blank" rel="noopener noreferrer"
          className="text-xs font-semibold shrink-0 hover:brightness-110 transition" style={{ color: "var(--glass-gold)" }}>More details →</a>
      </div>
      <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
        {card("Touches", data?.touches ?? 0, (r) => r.touches)}
        {card("Notes added", data?.notes ?? 0, (r) => r.notes)}
      </div>
    </section>
  );
}

// Facilities reads the facilities app's OWN booking feed, so team capacity
// matches its calendar exactly (courts x hours x 2). Null -> section omitted.
type BookingLoc = {
  location: string; nights: number; teams: number;
  by_status: Record<string, number>; off: number;
};
type BookingData = {
  season: string | null;
  locations: BookingLoc[];
  totals: { nights: number; teams: number; to_book: number; locations: number; by_status: Record<string, number> } | null;
};
const BOOKING_STATUS_LABEL: Record<string, string> = {
  booked_with_contract: "Contract",
  booked_with_flexibility: "Flexible",
  verbal_confirmation: "Verbal",
  in_communication: "In comms",
  need_to_book: "Need to book",
};
// Ordered from firmest to least committed, so a row reads left to right.
const BOOKING_STATUS_ORDER = ["booked_with_contract", "booked_with_flexibility", "verbal_confirmation", "in_communication", "need_to_book"];
const BOOKING_STATUS_COLOR: Record<string, string> = {
  booked_with_contract: "rgb(74,222,128)",
  booked_with_flexibility: "rgb(74,222,128)",
  verbal_confirmation: "var(--glass-gold)",
  in_communication: "var(--glass-text-secondary)",
  need_to_book: "rgb(248,113,113)",
};
async function loadBookings(season: string, scope: Scope): Promise<BookingData | null> {
  try {
    const url = new URL("/api/dashboard-kpis", "https://brodie-facilities.vercel.app");
    url.searchParams.set("season", season);
    const lp = locParam(scope.locationNames); if (lp) url.searchParams.set("location", lp);
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as BookingData;
    return k.locations ? k : null;
  } catch {
    return null;
  }
}

function BookingsSection({ data, season, titleSuffix = "", teamsRegistered }: { data: BookingData; season: string; titleSuffix?: string; teamsRegistered?: number }) {
  const t = data.totals;
  const booked = data.locations.filter((l) => l.nights > 0).length;
  const statusPill = (s: string, n: number) => (
    <span key={s} className="text-[11px] rounded-md px-1.5 py-0.5 border whitespace-nowrap"
      style={{
        color: BOOKING_STATUS_COLOR[s] ?? "var(--glass-text-secondary)",
        borderColor: s === "need_to_book" ? "rgba(239,68,68,0.35)" : "var(--glass-border)",
        background: s === "need_to_book" ? "rgba(239,68,68,0.10)" : "transparent",
      }}>
      {BOOKING_STATUS_LABEL[s] ?? s} <span className="font-bold tabular">{n}</span>
    </span>
  );
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h2 className="text-lg font-semibold" style={{ color: "var(--glass-text)" }}>Facility Bookings</h2>
          {titleSuffix && <span className="text-xs font-normal text-glass-text-tertiary">{titleSuffix}</span>}
          <span className="text-[9px] uppercase tracking-[0.16em] font-bold px-1.5 py-0.5 rounded"
            style={{ background: "var(--glass-gold-light, rgba(255,184,0,0.16))", color: "var(--glass-gold)" }}>{season}</span>
        </div>
        <a href={APP_URL.facilities} target="_blank" rel="noopener noreferrer"
          className="text-xs font-semibold shrink-0 hover:brightness-110 transition" style={{ color: "var(--glass-gold)" }}>More details →</a>
      </div>

      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        {/* Teams actually registered against the capacity booked for them, so
            the two read side by side rather than needing a second card. */}
        <StatTile
          label={teamsRegistered != null ? "Teams" : "Teams booked for"}
          value={(teamsRegistered ?? t?.teams ?? 0).toLocaleString()}
          sub={teamsRegistered != null ? "registered" : "courts x hours x 2"}
          tone="default"
          corner={teamsRegistered != null
            ? { label: "Booked for", value: (t?.teams ?? 0).toLocaleString(), color: "var(--glass-gold)" }
            : undefined}
        />
        <StatTile label="Nights booked" value={(t?.nights ?? 0).toLocaleString()}
          sub="past need-to-book" tone="default"
          lines={BOOKING_STATUS_ORDER.filter((s) => s !== "need_to_book" && t?.by_status[s])
            .map((s) => ({ text: `${t!.by_status[s]} — ${BOOKING_STATUS_LABEL[s]}` }))} />
        <StatTile label="Still to book" value={(t?.to_book ?? 0).toLocaleString()}
          sub="nights at need-to-book" tone={(t?.to_book ?? 0) > 0 ? "bad" : "ok"} />
        <StatTile label="Locations booked" value={`${booked}`} unit={`/ ${data.locations.length}`}
          sub="with at least one night" tone={booked === data.locations.length ? "ok" : "warn"}
          pills={data.locations.filter((l) => l.nights === 0).map((l) => l.location).sort((a, b) => a.localeCompare(b))}
          pillsEmpty="every location booked"
          pillTone="bad" />
      </div>

      <div className="rounded-2xl border border-glass-border bg-glass-surface overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-[0.18em] text-glass-text-tertiary border-b border-glass-border-light">
              <th className="px-5 py-3 font-bold">Location</th>
              <th className="px-5 py-3 font-bold text-right">Nights</th>
              <th className="px-5 py-3 font-bold text-right">Teams</th>
              <th className="px-5 py-3 font-bold">Booking status</th>
            </tr>
          </thead>
          <tbody>
            {data.locations.map((l) => (
              <tr key={l.location} className="border-t border-glass-border-light align-top">
                <td className="px-5 py-3 whitespace-nowrap font-semibold" style={{ color: "var(--glass-text)" }}>{l.location}</td>
                <td className="px-5 py-3 text-right tabular font-bold"
                  style={{ color: l.nights > 0 ? "var(--glass-text)" : "rgb(248,113,113)" }}>{l.nights}</td>
                <td className="px-5 py-3 text-right tabular font-bold" style={{ color: "var(--glass-gold)" }}>{l.teams.toLocaleString()}</td>
                <td className="px-5 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    {BOOKING_STATUS_ORDER.filter((s) => l.by_status[s]).map((s) => statusPill(s, l.by_status[s]))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SiteVisitsSection({ data, titleSuffix = "" }: { data: SiteVisitsData; titleSuffix?: string }) {
  const { weeks, by_dm } = data;
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-lg font-semibold" style={{ color: "var(--glass-text)" }}>Site Visits</h2>
          {titleSuffix && <span className="text-xs font-normal text-glass-text-tertiary">{titleSuffix}</span>}
        </div>
        <a href={`${APP_URL.feedback}/site-visits`} target="_blank" rel="noopener noreferrer"
          className="text-xs font-semibold shrink-0 hover:brightness-110 transition" style={{ color: "var(--glass-gold)" }}>More details →</a>
      </div>
      <div className="rounded-2xl border border-glass-border bg-glass-surface overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-[0.18em] text-glass-text-tertiary border-b border-glass-border-light">
              <th className="px-5 py-3 font-bold">Week</th>
              <th className="px-5 py-3 font-bold text-right">Visits</th>
              <th className="px-5 py-3 font-bold text-right">Avg score</th>
              <th className="px-5 py-3 font-bold">Scores</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((w) => (
              <tr key={w.week_start} className="border-t border-glass-border-light align-top">
                <td className="px-5 py-3 whitespace-nowrap align-top">
                  <div className="font-semibold" style={{ color: "var(--glass-text)" }}>{w.label}</div>
                  <div className="text-[10px] text-glass-text-tertiary mt-0.5">prev: {prevWeekLabel(w.week_start)}</div>
                </td>
                <td className="px-5 py-3 text-right align-top">
                  <div className="tabular font-bold" style={{ color: "var(--glass-text)" }}>{w.count}</div>
                  <div className="text-[10px] tabular text-glass-text-tertiary mt-0.5 whitespace-nowrap">{w.prev_count}</div>
                  <div className="text-[10px] tabular whitespace-nowrap" style={{ color: upColor(w.count_delta) }}>{signedN(w.count_delta)}</div>
                </td>
                <td className="px-5 py-3 text-right align-top">
                  <div className="tabular font-semibold" style={{ color: TONE_COLOR[w.avg_tone] }}>{w.avg_score == null ? "—" : `${w.avg_score}%`}</div>
                  <div className="text-[10px] tabular text-glass-text-tertiary mt-0.5 whitespace-nowrap">{w.prev_avg == null ? "—" : `${w.prev_avg}%`}</div>
                  {w.avg_delta != null && <div className="text-[10px] tabular whitespace-nowrap" style={{ color: upColor(w.avg_delta) }}>{signedN(w.avg_delta)}</div>}
                </td>
                <td className="px-5 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    {[...w.visits].sort((a, b) => a.location.localeCompare(b.location)).map((v, i) => (
                      <span key={i} className="text-[11px] rounded-md px-1.5 py-0.5 border border-glass-border whitespace-nowrap" style={{ color: "var(--glass-text-secondary)" }}>
                        {v.location} <span className="text-glass-text-tertiary">{v.day}</span> <span className="font-semibold" style={{ color: scoreTone(v.score) }}>{v.score == null ? "—" : `${Math.round(v.score)}%`}</span> <span className="text-glass-text-tertiary">· {v.dm}</span>
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {by_dm.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.18em] font-bold text-glass-text-tertiary">By district manager</span>
          {by_dm.map((d) => (
            <span key={d.dm} className="text-[11px] rounded-md px-2 py-0.5 border border-glass-border whitespace-nowrap" style={{ color: "var(--glass-text-secondary)" }}>
              {d.dm} <span className="font-bold tabular" style={{ color: "var(--glass-text)" }}>{d.count}</span>
              {" "}<span className="tabular" style={{ color: upColor(d.delta) }}>({signedN(d.delta)})</span>
              {d.avg_score != null && <> <span className="font-semibold tabular" style={{ color: TONE_COLOR[d.avg_tone] }}>{d.avg_score}%</span></>}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

// Video reviews completed each Sat–Fri week, by reviewer (counts only — video
// reviews are checklists with no single score).
function VideoReviewsSection({ data, titleSuffix = "" }: { data: VideoReviewsData; titleSuffix?: string }) {
  const { weeks, by_location } = data;
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-lg font-semibold" style={{ color: "var(--glass-text)" }}>Video Reviews</h2>
          {titleSuffix && <span className="text-xs font-normal text-glass-text-tertiary">{titleSuffix}</span>}
        </div>
        <a href={`${APP_URL.feedback}/video-review`} target="_blank" rel="noopener noreferrer"
          className="text-xs font-semibold shrink-0 hover:brightness-110 transition" style={{ color: "var(--glass-gold)" }}>More details →</a>
      </div>
      <div className="rounded-2xl border border-glass-border bg-glass-surface overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-[0.18em] text-glass-text-tertiary border-b border-glass-border-light">
              <th className="px-5 py-3 font-bold">Week</th>
              <th className="px-5 py-3 font-bold text-right">Reviews</th>
              <th className="px-5 py-3 font-bold">Nights not reviewed</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((w) => (
              <tr key={w.week_start} className="border-t border-glass-border-light align-top">
                <td className="px-5 py-3 whitespace-nowrap align-top">
                  <div className="font-semibold" style={{ color: "var(--glass-text)" }}>{w.label}</div>
                  <div className="text-[10px] text-glass-text-tertiary mt-0.5">prev: {prevWeekLabel(w.week_start)}</div>
                </td>
                <td className="px-5 py-3 text-right align-top">
                  {/* Coverage this week, then last week, then the change in
                      percentage points — counts alone hide a week that simply
                      had more nights to cover. */}
                  {(() => {
                    const pct = w.nights ? Math.round((w.reviewed / w.nights) * 100) : null;
                    const prevPct = w.prev_nights ? Math.round((w.prev_reviewed / w.prev_nights) * 100) : null;
                    const dPts = pct != null && prevPct != null ? pct - prevPct : null;
                    return (
                      <>
                        <div className="tabular font-bold whitespace-nowrap" style={{ color: "var(--glass-text)" }}>
                          {w.reviewed}/{w.nights}{" "}
                          <span style={{ color: pct == null ? "var(--glass-text-tertiary)" : TONE_COLOR[pctTone(pct)] }}>
                            {pct == null ? "—" : `${pct}%`}
                          </span>
                        </div>
                        <div className="text-[10px] tabular text-glass-text-tertiary mt-0.5 whitespace-nowrap">
                          {w.prev_reviewed}/{w.prev_nights} {prevPct == null ? "—" : `${prevPct}%`}
                        </div>
                        <div className="text-[10px] tabular whitespace-nowrap" style={{ color: upColor(dPts ?? 0) }}>
                          {dPts == null ? "—" : `${dPts > 0 ? "+" : ""}${dPts}pts`}
                        </div>
                      </>
                    );
                  })()}
                </td>
                <td className="px-5 py-3">
                  {w.missing_list.length === 0 ? (
                    <span className="text-[11px] italic text-glass-text-tertiary">
                      {w.nights === 0 ? "no game nights" : "all nights reviewed"}
                    </span>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {w.missing_list.map((v, i) => (
                        <span key={i} className="text-[11px] rounded-md px-1.5 py-0.5 border whitespace-nowrap"
                          style={{ color: "var(--glass-danger-text, rgb(248,113,113))", borderColor: "rgba(239,68,68,0.35)", background: "rgba(239,68,68,0.10)" }}>
                          {v.location} <span style={{ opacity: 0.75 }}>{v.day}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {by_location.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.18em] font-bold text-glass-text-tertiary">Completed by location</span>
          {by_location.map((d) => (
            <span key={d.location} className="text-[11px] rounded-md px-2 py-0.5 border border-glass-border whitespace-nowrap" style={{ color: "var(--glass-text-secondary)" }}>
              {d.location} <span className="font-bold tabular" style={{ color: "var(--glass-text)" }}>{d.completed}</span>
              <span className="text-glass-text-tertiary">/{d.nights}</span>
              {" "}<span className="tabular" style={{ color: upColor(d.delta) }}>({signedN(d.delta)})</span>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

function Section({
  title,
  href,
  tiles,
  sample = false,
  seasonTag,
  scopeTag,
  cols = 4,
}: {
  title: string;
  href?: string;
  tiles: Tile[];
  sample?: boolean;
  seasonTag?: string;
  // Scope note beside the heading ("(Weekly)"), set smaller and muted so it
  // reads as a label rather than part of the title.
  scopeTag?: string;
  // Sections with more than four tiles can ask for a wider grid so the row
  // doesn't wrap. Class names are spelled out because Tailwind scans literals.
  cols?: 4 | 6;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h2 className="text-lg font-semibold" style={{ color: "var(--glass-text)" }}>{title}</h2>
          {scopeTag && <span className="text-xs font-normal text-glass-text-tertiary">{scopeTag}</span>}
          {seasonTag && (
            <span className="text-[9px] uppercase tracking-[0.16em] font-bold px-1.5 py-0.5 rounded"
              style={{ background: "var(--glass-gold-light, rgba(255,184,0,0.16))", color: "var(--glass-gold)" }}>
              {seasonTag}
            </span>
          )}
          {sample && (
            <span className="text-[9px] uppercase tracking-[0.16em] font-bold px-1.5 py-0.5 rounded"
              style={{ background: "var(--glass-surface-hover)", color: "var(--glass-text-tertiary)" }}>
              sample
            </span>
          )}
        </div>
        {href && (
          <a href={href} target="_blank" rel="noopener noreferrer"
            className="text-xs font-semibold shrink-0 hover:brightness-110 transition" style={{ color: "var(--glass-gold)" }}>
            More details →
          </a>
        )}
      </div>
      {tiles.length ? (
        <div className={cols === 6
          ? "grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6"
          : "grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4"}>
          {tiles.map((t, i) => <StatTile key={i} {...t} />)}
        </div>
      ) : (
        <div className="rounded-xl border border-glass-border bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary">
          Cards coming soon — open the app for the full view.
        </div>
      )}
    </section>
  );
}

function StatTile({ label, value, unit, sub, subInline, lines, tone = "default", link, pills, pillsEmpty, pillTone, corner }: Tile) {
  const color =
    tone === "ok" ? "rgb(74,222,128)" :
    tone === "warn" ? "var(--glass-gold)" :
    tone === "bad" ? "rgb(248,113,113)" : "var(--glass-text)";
  return (
    <div className="rounded-xl border border-glass-border bg-glass-surface px-4 py-3.5 min-w-0">
      {/* The corner shares the card's rows rather than stacking beside them:
          its label sits on the label row, its value on the value row, and its
          follow-up lines on the first lines below. */}
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-[10px] uppercase tracking-[0.16em] font-bold text-glass-text-tertiary truncate">{label}</div>
        {corner && (
          <div className="text-[10px] uppercase tracking-[0.16em] font-bold text-glass-text-tertiary shrink-0">{corner.label}</div>
        )}
      </div>
      <div className="mt-1.5 flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-1.5">
          <span className="text-2xl font-bold tabular" style={{ color }}>{value}</span>
          {unit && <span className="text-sm text-glass-text-tertiary">{unit}</span>}
          {sub && subInline && <span className="text-[11px] text-glass-text-tertiary leading-snug">{sub}</span>}
        </div>
        {corner && (
          <span className="text-2xl font-bold tabular shrink-0" style={{ color: corner.color ?? "var(--glass-text)" }}>{corner.value}</span>
        )}
      </div>
      {sub && !subInline && <div className="text-[11px] text-glass-text-tertiary mt-1 leading-snug">{sub}</div>}
      {((lines?.length ?? 0) > 0 || (corner?.lines?.length ?? 0) > 0) && (
        <div className="mt-2 space-y-0.5 tabular">
          {Array.from({ length: Math.max(lines?.length ?? 0, corner?.lines?.length ?? 0) }).map((_, i) => {
            const l = lines?.[i];
            const c = corner?.lines?.[i];
            return (
            // A row paired with a corner line matches its size on both sides.
            <div key={i} className={`${c ? "text-[10px]" : "text-xs"} leading-snug flex items-baseline gap-2`}>
            <div
              className="flex items-center gap-1.5 flex-wrap min-w-0"
              style={{ color: l?.color ?? (l?.strong ? "var(--glass-text)" : "var(--glass-text-tertiary)"), fontWeight: l?.strong ? 600 : 400 }}
            >
              {l && <span>{l.text}</span>}
              {l?.pill && (
                <span
                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                  style={{
                    color: l.pill.ok ? "rgb(74,222,128)" : "rgb(248,113,113)",
                    background: l.pill.ok ? "rgba(34,197,94,0.14)" : "rgba(239,68,68,0.14)",
                  }}
                >
                  {l.pill.text}
                </span>
              )}
              {l?.after && (
                <span className="font-normal" style={{ color: l.afterColor ?? "var(--glass-text-tertiary)" }}>{l.after}</span>
              )}
            </div>
            {c && (
              <span className="ml-auto text-[10px] tabular whitespace-nowrap shrink-0"
                style={{ color: c.color ?? "var(--glass-text-tertiary)" }}>{c.text}</span>
            )}
            </div>
            );
          })}
        </div>
      )}
      {pills && (
        pills.length === 0 ? (
          pillsEmpty ? <div className="mt-2 text-[11px] italic text-glass-text-tertiary">{pillsEmpty}</div> : null
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {pills.map((p) => (
              <span key={p} className="text-[11px] rounded-md px-1.5 py-0.5 border whitespace-nowrap"
                style={
                  (pillTone ?? tone) === "bad"
                    ? { color: "rgb(248,113,113)", borderColor: "rgba(239,68,68,0.35)", background: "rgba(239,68,68,0.10)" }
                    : { color: "var(--glass-text-secondary)", borderColor: "var(--glass-border)" }
                }>
                {p}
              </span>
            ))}
          </div>
        )
      )}
      {link && (
        <a href={link.href} target="_blank" rel="noopener noreferrer"
          className="inline-block mt-2.5 text-xs font-semibold hover:brightness-110 transition" style={{ color: "var(--glass-gold)" }}>
          {link.label}
        </a>
      )}
    </div>
  );
}
