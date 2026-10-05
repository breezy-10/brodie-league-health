import { Suspense, type ReactNode } from "react";
import { readAppSecret } from "@/lib/app-secrets";
import { requireUser } from "@/lib/auth";
import { SectionSkeleton, TableSkeleton } from "./Skeletons";
import { createAdminClient } from "@/lib/supabase/admin";
import { sourceClient, sourceConfigured } from "@/lib/source-apps/clients";
import { resolveLocationsForLM, resolveLocationIdsByName } from "@/lib/source-apps/cross-app-locations";
import type { AppSlug } from "@/lib/source-apps/clients";
import { ymd } from "@/lib/source-apps/util";
import { canonicalLocation, loadActiveLMs, locParam, resolveScope, seasonKey, shortSeason } from "@/lib/seasons";
import Filters, { type FilterOptions } from "./Filters";
import { BasisToggle } from "./BasisToggle";
import StatTile, { type Tile, type Tone } from "./StatTile";
import DeadlineBanner, { type DeadlineWeek } from "./DeadlineBanner";
import type { DiscountRow } from "../discounts/DiscountsView";
import { discountTone, freeTone } from "../discounts/rates";
import { promoFetch } from "@/lib/promo-feed";

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
        const r = await promoFetch(url.toString(), { cache: "no-store" });
        return r.ok ? ((await r.json()) as Pacing) : null;
      })(),
    ]);
    const seasonIds = fSeasons
      .filter((s) => s.name && seasonKey(s.name) === want).map((s) => s.id);
    if (!seasonIds.length || !pacingRes) return null;

    const cityById = new Map(facilities.map((f) => [f.id, f.city ?? ""]));
    // Any booking row for the season, whatever its status, means the season is
    // planned at that venue — "need to book" included. Requiring a booking that
    // was already in communication left out every market still to be booked:
    // 13 for Winter '27 (Brampton, Mississauga, Kitchener, Vaughan, Brooklyn…),
    // so the checklist card silently skipped most of the network.
    const { data: bookings } = await fac.from("bookings")
      .select("facility_id").in("season_id", seasonIds);
    const bookedCities = new Set(((bookings ?? []) as { facility_id: string }[])
      .map((b) => cityById.get(b.facility_id) ?? "").filter(Boolean));

    const registered = (pacingRes.locations ?? [])
      .filter((l) => {
        const cur = l.seasons.find((s) => s.kind === "current");
        return !!cur && (cur.captains > 0 || cur.athletes > 0);
      })
      .map((l) => l.location);
    if (!registered.length && !bookedCities.size) return null;

    // Planned (a booking for the season) OR already registering. Either one
    // says the location runs this season; asking for both dropped Kitchener
    // (booked, no registrations yet) and every venue not booked yet.
    return candidates.filter((n) =>
      registered.some((r) => sameLocation(n, r)) || [...bookedCities].some((c) => sameLocation(n, c)));
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
    sb.from("seasons").select("id, name, kind, location_id"),
    sb.from("locations").select("id, name"),
  ]);
  const locSet = locIds ? new Set(locIds) : null;
  const want = seasonKey(season);
  const seasonRows = ((seasons ?? []) as { id: string; name: string | null; kind: string | null; location_id: string | null }[])
    .filter((s) => s.name && seasonKey(s.name) === want);
  const ids = seasonRows
    .filter((s) => !locSet || (s.location_id != null && locSet.has(s.location_id)))
    .map((s) => s.id);

  // Which locations have no checklist for this season at all. A location the
  // checklist app has never heard of counts as missing too, so this is matched
  // by name against the canonical list rather than by id.
  const withChecklist = new Set(seasonRows.map((s) => s.location_id).filter(Boolean) as string[]);
  let missingLocations: string[] = [];
  let setUpLocations: string[] = [];
  if (expectedLocations.length) {
    const rows = (clLocs ?? []) as { id: string; name: string }[];
    const inScope = scope.locationNames ? new Set(scope.locationNames) : null;
    // Only markets actually running this season are expected to have one. When
    // that can't be determined, fall back to every candidate rather than
    // silently reporting nothing outstanding.
    const operating = await operatingPromise;
    const running = (operating ?? expectedLocations)
      .filter((n) => !inScope || inScope.has(n))
      .sort((a, b) => a.localeCompare(b));
    const hasChecklist = (n: string) => rows.some((l) => sameLocation(n, l.name) && withChecklist.has(l.id));
    setUpLocations = running.filter(hasChecklist);
    missingLocations = running.filter((n) => !hasChecklist(n));
  }
  const list = await readSeasonTasks<{ season_id: string; status: string; due_date: string | null }>(
    sb, "season_id, status, due_date", ids);
  const total = list.length;
  const done = list.filter((t) => t.status === "done").length;
  const today = ymd(new Date());
  const overdueRows = list.filter((t) => t.due_date && t.due_date < today && t.status === "not_started");
  const overdue = overdueRows.length;
  const pct = total ? Math.round((100 * done) / total) : 0;
  // Which locations the overdue work is at, the way the card beside it names
  // the ones with no checklist. A single number over twenty markets says how
  // much is late and nothing about whose week it is.
  const clName = new Map(((clLocs ?? []) as { id: string; name: string }[]).map((l) => [l.id, l.name]));
  // The Operations checklist is a real checklist with no venue behind it, so it
  // is named for what it is rather than lumped in as unknown.
  const seasonLoc = new Map(seasonRows.map((s) => [
    s.id,
    (s.location_id ? clName.get(s.location_id) : null) ?? (s.kind === "operations" ? "Operations" : "No location"),
  ]));
  const overdueByLoc = new Map<string, number>();
  for (const t of overdueRows) {
    const name = seasonLoc.get(t.season_id) ?? "No location";
    overdueByLoc.set(name, (overdueByLoc.get(name) ?? 0) + 1);
  }
  // Setup comes before progress: a location with no checklist isn't counted in
  // the percentages beside it, so it reads first.
  return [
    {
      // Both sides of the setup question: how many running locations have a
      // checklist for the season (green) and how many still don't (red), with
      // every location named in the matching colour underneath.
      label: `Checklist · ${season}`,
      value: setUpLocations.length.toLocaleString(),
      sub: "set up",
      subInline: true,
      tone: setUpLocations.length > 0 ? "ok" : "default",
      // Stacked under "set up" rather than in the corner, where it squeezed
      // the card's title off the row.
      below: {
        value: missingLocations.length.toLocaleString(),
        sub: "not set up",
        color: missingLocations.length > 0 ? "rgb(248,113,113)" : "var(--glass-text-tertiary)",
        pills: missingLocations.map((n) => ({ text: n, tone: "bad" as const })),
      },
      // Each group under its own count, A-Z — no sort control, since the
      // grouping already says which is which.
      pills: setUpLocations.map((n) => ({ text: n, tone: "ok" as const })),
    },
    { label: `Tasks complete · ${season}`, value: `${pct}%`, sub: `${done.toLocaleString()} / ${total.toLocaleString()}`, tone: pct >= 100 ? "ok" : pct > 0 ? "warn" : "bad" },
    {
      label: `Overdue tasks · ${season}`, value: overdue.toLocaleString(),
      sub: "not started, past due", tone: overdue > 0 ? "bad" : "ok",
      // A-Z, so a venue is found where you expect it rather than wherever its
      // count put it this week. The two that are not venues sort to the end.
      pills: [...overdueByLoc.entries()]
        .sort((a, b) => {
          const rank = (n: string) => (n === "Operations" || n === "No location" ? 1 : 0);
          return rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]);
        })
        .map(([name, n]) => ({ text: `${name} (${n})`, tone: "bad" as const, sortValue: n })),
      pillsEmpty: "nothing past due",
    },
  ];
}

// When the selected season started, per the stats app — the same table
// resolveScope reads to decide which season is being played.
async function seasonStartDate(season: string): Promise<string | null> {
  if (!sourceConfigured("stats_health")) return null;
  try {
    const st = sourceClient("stats_health")!;
    const { data } = await st.from("seasons").select("name, start_date");
    const want = seasonKey(season);
    const row = ((data ?? []) as { name: string | null; start_date: string | null }[])
      .find((r) => r.name && seasonKey(r.name) === want);
    return row?.start_date ?? null;
  } catch {
    return null;
  }
}

// Supabase returns at most 1,000 rows from a select and says nothing about it,
// so both checklist cards were reporting a slice of their own season: the game
// day card read 607 of 1,871 tasks across 37 of 69 nights, and the season
// checklist 491 of 1,533 — each landing on a suspiciously round 1,000 total.
// Every figure downstream (the percentage, the per-night chips, blocked,
// nights not started) was computed off whichever thousand rows came back.
/* eslint-disable @typescript-eslint/no-explicit-any */
async function readSeasonTasks<T>(sb: any, cols: string, ids: string[]): Promise<T[]> {
  const out: T[] = [];
  // The id list is chunked too: a season's worth of nights makes an .in() long
  // enough to strain the query string.
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    for (let from = 0; from < 100_000; from += 1000) {
      const { data, error } = await sb.from("season_tasks").select(cols)
        .in("season_id", chunk).order("id").range(from, from + 999);
      if (error || !data) break;
      out.push(...(data as T[]));
      if (data.length < 1000) break;
    }
  }
  return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const WEEK_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// Game day checklists: one per venue per night, generated from the published
// schedule. Health here is "did the night actually get worked", so it only ever
// reads nights that have happened — a window running to today, never past it,
// or the figures drown in nights nobody could have worked yet.
//
// The window follows the tab: the selected Saturday-Friday week on Weekly
// review, the season so far on Season review.
//
// Scoped to seasons.kind = 'lm_game_day'; the season/onboarding checklists are
// counted by loadChecklistTiles above and must not be mixed in.
async function loadGameDayTiles(scope: Scope, season: string, weeks: string[]): Promise<Tile[] | null> {
  if (!sourceConfigured("checklist")) return null;
  const sb = sourceClient("checklist")!;

  const today = ymd(new Date());
  const wks = [...weeks].sort();
  // A week runs Saturday to Friday; the season runs from its own start date,
  // which the stats app holds. Either way the window stops at today.
  const lastDay = wks.length ? addDaysIso(wks[wks.length - 1], 6) : today;
  const [locIds, { data: seasons }, { data: clLocs }, seasonStart] = await Promise.all([
    sourceLocationIds("checklist", scope),
    sb.from("seasons").select("id, location_id, opening_night").eq("kind", "lm_game_day"),
    sb.from("locations").select("id, name"),
    wks.length ? Promise.resolve(null) : seasonStartDate(season),
  ]);
  type Night = { id: string; location_id: string | null; opening_night: string };
  const locSet = locIds ? new Set(locIds) : null;
  const nameById = new Map(((clLocs ?? []) as { id: string; name: string }[]).map((l) => [l.id, l.name]));

  const from = wks.length ? wks[0] : seasonStart ?? "0000-01-01";
  const to = lastDay < today ? lastDay : today;
  const nights = ((seasons ?? []) as Night[])
    .filter((n) => !locSet || (n.location_id != null && locSet.has(n.location_id)))
    .filter((n) => n.opening_night >= from && n.opening_night <= to);

  const recent = nights;
  const ids = [...new Set(recent.map((n) => n.id))];

  // Only the nights in play, and read in pages: a checklist per night per venue
  // runs past the 1,000-row cap several times over in a season.
  const tasks = await readSeasonTasks<{ season_id: string; status: string }>(sb, "season_id, status", ids);

  const doneOf = (list: Night[]) => {
    const set = new Set(list.map((n) => n.id));
    const rows = tasks.filter((t) => set.has(t.season_id));
    const done = rows.filter((t) => t.status === "done" || t.status === "skipped").length;
    return { done, total: rows.length, pct: rows.length ? Math.round((100 * done) / rows.length) : 0 };
  };

  const weekStats = doneOf(recent);

  // Blocked over the same window as the card beside it, so the two read off one
  // denominator. Named where it is blocked, not just how much: a blocked task
  // is someone stuck waiting on something, and the venue and night are what
  // make that chaseable.
  const recentIds = new Set(recent.map((n) => n.id));
  const blockedRows = tasks.filter((t) => recentIds.has(t.season_id) && t.status === "blocked");
  const blockedPct = weekStats.total ? Math.round((1000 * blockedRows.length) / weekStats.total) / 10 : 0;
  // Skipped counts as complete on the card beside it, so this says how much of
  // that completion is skipping rather than doing.
  const skippedRows = tasks.filter((t) => recentIds.has(t.season_id) && t.status === "skipped");
  const skippedPct = weekStats.total ? Math.round((1000 * skippedRows.length) / weekStats.total) / 10 : 0;

  // Completion venue by venue AND night by night. A venue is not one job: a
  // manager works Monday's checklist and Wednesday's separately, and rolling
  // them together hid Burlington's Mondays at 48 of 55 behind its Wednesdays at
  // 24 of 55. Coloured on the card's own thresholds, so a night that is behind
  // reads as behind.
  const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dayOf = (iso: string) => {
    // The date is a plain YYYY-MM-DD; read it as UTC so the weekday does not
    // shift west of Greenwich.
    const d = new Date(`${iso}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? "" : DAY_NAMES[d.getUTCDay()];
  };
  const byNight = new Map<string, { loc: string; day: string; done: number; blocked: number; skipped: number; total: number }>();
  for (const n of recent) {
    const loc = nameById.get(n.location_id ?? "") ?? "Unknown";
    const day = dayOf(n.opening_night);
    const key = `${loc} ${day}`;
    const rows = tasks.filter((t) => t.season_id === n.id);
    const cur = byNight.get(key) ?? { loc, day, done: 0, blocked: 0, skipped: 0, total: 0 };
    cur.done += rows.filter((t) => t.status === "done" || t.status === "skipped").length;
    cur.blocked += rows.filter((t) => t.status === "blocked").length;
    cur.skipped += rows.filter((t) => t.status === "skipped").length;
    cur.total += rows.length;
    byNight.set(key, cur);
  }
  // Venue and night, worst first by share — the same grouping the completion
  // chips use, so the two cards describe the same things. A date named one
  // occurrence of a night that repeats every week; the weekday names the night
  // itself, which is what gets worked.
  const nightOrder = (a: { loc: string; day: string }, b: { loc: string; day: string }) =>
    a.loc.localeCompare(b.loc) || WEEK_ORDER.indexOf(a.day) - WEEK_ORDER.indexOf(b.day);

  // A night that finished with nothing ticked is the thing worth chasing.
  const untouched = recent
    .filter((n) => n.opening_night < today)
    .filter((n) => !tasks.some((t) => t.season_id === n.id && t.status !== "not_started"))
    .map((n) => `${nameById.get(n.location_id ?? "") ?? "Unknown"} · ${n.opening_night}`)
    .sort();

  const none = wks.length ? "no game days in the selected week" : "no game days yet this season";
  const nightsSub = `${recent.length} game day${recent.length === 1 ? "" : "s"}`;
  return [
    {
      label: "Tasks complete",
      value: recent.length ? `${weekStats.pct}%` : "—",
      sub: recent.length ? `${weekStats.done} / ${weekStats.total} tasks · ${nightsSub}` : none,
      tone: !recent.length ? "ok" : weekStats.pct >= 90 ? "ok" : weekStats.pct >= 50 ? "warn" : "bad",
      // A night with nothing ticked belongs on the card that exists to name
      // those, not as a row of noughts here.
      pills: [...byNight.values()]
        .filter((v) => v.done > 0)
        .sort(nightOrder)
        .map((v) => {
          const pct = v.total ? Math.round((100 * v.done) / v.total) : 0;
          return {
            text: `${v.loc} ${v.day} ${v.done}/${v.total} (${pct}%)`,
            tone: (pct >= 90 ? "ok" : pct >= 50 ? "warn" : "bad") as Tone,
            sortValue: pct,
          };
        }),
      pillsEmpty: recent.length ? "nothing started yet" : none,
    },
    {
      label: "% blocked",
      // One decimal: a handful of blocked tasks in a thousand rounds to zero as
      // a whole percent, and zero is exactly what this card must not say while
      // anything is stuck.
      value: recent.length ? `${blockedPct.toFixed(1)}%` : "—",
      sub: recent.length ? `${blockedRows.length} / ${weekStats.total} tasks · ${nightsSub}` : none,
      tone: !recent.length || !blockedRows.length ? "ok" : blockedPct >= 5 ? "bad" : "warn",
      pills: [...byNight.values()]
        .filter((v) => v.blocked > 0)
        .sort(nightOrder)
        .map((v) => ({
          text: `${v.loc} ${v.day} ${v.blocked}/${v.total} (${v.total ? Math.round((100 * v.blocked) / v.total) : 0}%)`,
          tone: "bad" as const,
          sortValue: v.total ? (100 * v.blocked) / v.total : 0,
        })),
      pillsEmpty: "nothing blocked",
    },
    {
      label: "% skipped",
      // Same window and denominator as the two before it, one decimal for the
      // same reason. Gold rather than red: skipping a task can be the right
      // call; a night skipping a tenth or more of its list is the one to ask
      // about.
      value: recent.length ? `${skippedPct.toFixed(1)}%` : "—",
      sub: recent.length ? `${skippedRows.length} / ${weekStats.total} tasks · ${nightsSub}` : none,
      tone: !recent.length || !skippedRows.length ? "ok" : skippedPct >= 10 ? "bad" : "warn",
      pills: [...byNight.values()]
        .filter((v) => v.skipped > 0)
        .sort(nightOrder)
        .map((v) => {
          const pct = v.total ? (100 * v.skipped) / v.total : 0;
          return {
            text: `${v.loc} ${v.day} ${v.skipped}/${v.total} (${Math.round(pct)}%)`,
            tone: (pct >= 10 ? "bad" : "warn") as Tone,
            sortValue: pct,
          };
        }),
      pillsEmpty: "nothing skipped",
    },
    {
      label: "Nights not started",
      value: untouched.length.toLocaleString(),
      sub: "played, nothing ticked off",
      subInline: true,
      tone: untouched.length > 0 ? "bad" : "ok",
      pills: untouched,
      pillsEmpty: "every night was worked",
    },
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
    const res = await promoFetch(url.toString(), { cache: "no-store" });
    // A location this app does not track is not a failed read — and must not
    // fall through to the sample tiles, which would put invented numbers on a
    // filtered dashboard. Empty tiles render an explicit note instead.
    if (res.status === 404) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (body?.error === "location_not_found") return [];
    }
    // A location this app does not track is not a failed read — and must not
    // fall through to the sample tiles, which would put invented numbers on a
    // filtered dashboard. Empty tiles render an explicit note instead.
    if (res.status === 404) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (body?.error === "location_not_found") return [];
    }
    if (!res.ok) return null;
    const k = (await res.json()) as {
      responses: number; csat_pct: number | null; csat_tone: Tone; csat_satisfied: number; csat_total: number;
      nps: number | null; nps_tone: Tone; promoters: number; detractors: number; nps_total: number;
      promoter_pct: number | null; detractor_pct: number | null;
      retention_pct: number | null; retention_yes: number; retention_thinking: number; retention_no: number;
      by_location?: {
        location: string; responses: number;
        csat_pct: number | null; csat_satisfied: number; csat_total: number;
        nps: number | null; nps_total: number;
        retention_pct: number | null; retention_yes: number; retention_n: number;
      }[];
    };
    // Tones come from the feedback site's own colour functions (csatColor/npsColor);
    // Returning intent is left uncoloured, matching that site.
    //
    // Each card also names the venues behind its number. The bands are the
    // feedback site's own: CSAT green from 80 and amber from 60, NPS green from
    // 50 and amber from 0 — so a venue reads the same colour in both places.
    // Returning intent stays uncoloured here too, because that site does not
    // claim a good number for it.
    const by = k.by_location;
    const pills = <T,>(f: (r: NonNullable<typeof by>[number]) => T | null) =>
      by ? { pills: by.map(f).filter((x): x is T => x !== null) as Tile["pills"], pillsEmpty: "no responses yet" } : {};
    return [
      {
        label: "Responses", value: k.responses.toLocaleString(),
        ...pills((r) => ({ text: `${r.location} (${r.responses})`, tone: "default" as const, sortValue: r.responses })),
      },
      {
        label: "CSAT", value: k.csat_pct == null ? "—" : `${k.csat_pct}%`,
        sub: k.csat_pct == null ? "no CSAT question" : `${k.csat_satisfied} of ${k.csat_total} rated 8 or higher`,
        tone: k.csat_tone ?? "default",
        ...pills((r) => r.csat_pct == null ? null : ({
          text: `${r.location} ${r.csat_satisfied}/${r.csat_total} (${r.csat_pct}%)`,
          tone: (r.csat_pct >= 80 ? "ok" : r.csat_pct >= 60 ? "warn" : "bad") as Tone,
          sortValue: r.csat_pct,
        })),
      },
      {
        label: "NPS", value: k.nps == null ? "—" : `${k.nps}`,
        sub: k.nps == null ? "no NPS scored" : `${k.promoter_pct}% promoters (${k.promoters}) · ${k.detractor_pct}% detractors (${k.detractors}) of ${k.nps_total} scored`,
        tone: k.nps_tone ?? "default",
        ...pills((r) => r.nps == null ? null : ({
          text: `${r.location} ${r.nps} (${r.nps_total})`,
          tone: (r.nps >= 50 ? "ok" : r.nps >= 0 ? "warn" : "bad") as Tone,
          sortValue: r.nps,
        })),
      },
      {
        label: "Returning intent", value: k.retention_pct == null ? "—" : `${k.retention_pct}%`,
        sub: k.retention_pct == null ? "no retention question" : `${k.retention_yes} yes · ${k.retention_thinking} thinking · ${k.retention_no} no`,
        ...pills((r) => r.retention_pct == null ? null : ({
          text: `${r.location} ${r.retention_yes}/${r.retention_n} (${r.retention_pct}%)`,
          tone: "default" as const,
          sortValue: r.retention_pct,
        })),
      },
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
  by_location?: { location: string; delivered: number; hours: number; rate: number | null }[];
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
// Green at or above target, amber within a quarter of it, red below — the
// card's own target rather than a number invented here, so a venue reads
// against the bar its work is actually set.
const rateTone = (rate: number, target: number): Tone =>
  rate >= target ? "ok" : rate >= target * 0.75 ? "warn" : "bad";

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
    // Rate per venue, against the card's own target. The delivered count rides
    // along because a rate off two hours is not the same claim as one off
    // twenty.
    pills: (c.by_location ?? []).map((r) => ({
      text: `${r.location} ${r.rate}/hr (${r.delivered})`,
      tone: rateTone(r.rate ?? 0, c.target),
      sortValue: r.rate ?? 0,
    })),
    pillsEmpty: "no hours logged",
  };
}
async function loadContentTiles(season: string, scope: Scope, week?: string): Promise<Tile[] | null> {
  try {
    const url = new URL("/api/dashboard-kpis", "https://brodie-content-health.vercel.app");
    url.searchParams.set("season", season);
    if (week) url.searchParams.set("week", week);
    const lp = locParam(scope.locationNames); if (lp) url.searchParams.set("location", lp);
    const res = await promoFetch(url.toString(), { cache: "no-store" });
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
  by_location?: { location: string; done: number; total: number; pct: number }[];
  week?: { count: number; prev_count: number; delta: number } | null;
};
// In Weekly Review the headline becomes the week's own count (how many athletes
// were tagged / had a profile set that week), with the previous week and the
// delta beneath it; season-to-date completion moves to a supporting line.
function rosterTile(label: string, c: RosterCard, split: string, noun: string): Tile {
  const pills = (c.by_location ?? []).map((r) => ({
    text: `${r.location} ${r.done}/${r.total} (${r.pct}%)`,
    tone: (r.pct >= 95 ? "ok" : r.pct >= 80 ? "warn" : "bad") as Tone,
    sortValue: r.pct,
  }));
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
      // Season-to-date per venue either way: a week's tagging is too few
      // athletes per venue to read as a rate, and the backlog is what the
      // chasing is against.
      pills, pillsEmpty: "no roster yet",
    };
  }
  return {
    label, value: c.done.toLocaleString(), unit: `/ ${c.total.toLocaleString()}`,
    sub: `${c.pct}% complete`, tone: c.total === 0 ? "default" : pctTone(c.pct),
    lines: [{ text: split }],
    pills, pillsEmpty: "no roster yet",
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
    const res = await promoFetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as {
      stats_completion_pct: number | null; stats_completion_tone?: Tone; full_recording_tone?: Tone; games_played: number | null; games_tracked: number;
      by_source: { ballertv: number; livebarn: number; scoresheet: number }; no_stats: number;
      full_recording_pct: number | null; full: number; incomplete: number; recording_total: number;
      spare_appearances: number; spare_games: number;
      // The games page filtered to the spares these counts cover.
      games_with_spares_path?: string;
      stat_delivery_ms: number | null; stat_delivery_n: number;
      forfeits?: number; pending_review?: number; awaiting_stats?: number; prev_forfeits?: number | null;
      forfeits_by_location?: { location: string; day?: string; forfeits: number }[];
      prev_stats_completion_pct?: number | null;
      prev_full_recording_pct?: number | null;
      prev_stat_delivery_ms?: number | null;
      completion_by_location?: { location: string; done: number; reported: number; pct: number; livebarn?: number; scoresheet?: number }[];
      spares_by_location?: { location: string; spares: number; games: number }[];
      delivery_by_location?: { location: string; ms: number; games: number }[];
      recording_by_location?: { location: string; full: number; total: number; pct: number }[];
      // Games with no player stats some hours after game time (72 today), per
      // venue (zeros too).
      stats_overdue?: {
        hours: number; total: number; waiting: number; no_stats: number; games: number;
        // The Stats Health games list showing exactly these games.
        path?: string;
        by_location: { location: string; total: number; waiting: number; no_stats: number; games: number }[];
      };
      // Box score points against the final score (Stats Health's reconciliation).
      points_check?: {
        checked: number; reconciled: number; off: number; no_stats: number;
        path?: string;
        by_location: { location: string; checked: number; off: number }[];
      };
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
    // Games already played and still waiting for stats — not future games
    // (pending_review counted the whole remaining schedule), not forfeits, and
    // not games already marked as having no stats. Only from a feed that
    // carries the count; the old pending figure would overstate it.
    if (k.awaiting_stats) completionLines.push({ text: `${n(k.awaiting_stats)} — not posted yet`, color: "var(--glass-gold)" });
    const fDelta = k.forfeits != null && k.prev_forfeits != null ? k.forfeits - k.prev_forfeits : null;
    return [
      {
        label: "Stats completion rate", value: k.stats_completion_pct == null ? "—" : `${k.stats_completion_pct}%`,
        tone: k.stats_completion_tone ?? (k.stats_completion_pct == null ? "default" : pctTone(k.stats_completion_pct)),
        lines: [...wowPct(k.stats_completion_pct, k.prev_stats_completion_pct), ...completionLines],
        // Under the source breakdown: which venues are actually getting stats
        // in. 96% across the league can still hide a venue at half that.
        // Banded on the card's own tones — 95 and 85, the thresholds Stats
        // Health itself uses.
        ...(k.completion_by_location ? {
          pills: k.completion_by_location.map((r) => {
            // Where the stream did not do the job. Completion counts a stat as
            // a stat, so a venue that got its numbers off a scoresheet reads
            // 100% exactly like one where BallerTV worked — and it is BallerTV
            // that players actually watch. Only shown where it happened.
            const fell = [
              ...(r.livebarn ? [`${r.livebarn} LiveBarn`] : []),
              ...(r.scoresheet ? [`${r.scoresheet} in-venue`] : []),
            ];
            return {
              text: `${r.location} ${r.done}/${r.reported} (${r.pct}%)${fell.length ? ` · ${fell.join(" · ")}` : ""}`,
              tone: (r.pct >= 95 ? "ok" : r.pct >= 85 ? "warn" : "bad") as Tone,
              sortValue: r.pct,
            };
          }),
          pillsEmpty: "nothing reviewed yet",
        } : {}),
      },
      {
        label: "Stat delivery time", value: k.stat_delivery_ms == null ? "—" : fmtElapsed(k.stat_delivery_ms),
        tone: "default",
        lines: [
          ...wowElapsed(k.stat_delivery_ms, k.prev_stat_delivery_ms),
          { text: `${n(k.stat_delivery_n)} games processed` },
        ],
        // Against the league average rather than a fixed target: what counts as
        // slow here depends on the season everyone is having.
        ...(k.delivery_by_location ? {
          pills: k.delivery_by_location.map((r) => ({
            text: `${r.location} ${fmtElapsed(r.ms)} (${r.games})`,
            sortValue: r.ms,
            tone: (k.stat_delivery_ms == null ? "default"
              : r.ms <= k.stat_delivery_ms ? "ok"
                : r.ms <= k.stat_delivery_ms * 1.5 ? "warn" : "bad") as Tone,
          })),
          pillsEmpty: "nothing submitted yet",
        } : {}),
      },
      {
        label: "Spare players", value: n(k.spare_appearances), tone: k.spare_appearances > 0 ? "warn" : "default",
        // The two totals restated the headline and the count of games behind
        // it; where the spares keep being needed is the part anyone can act on.
        // Only where the feed actually carries the breakdown, though — an
        // older one would have this card saying "no spares used" under a
        // headline of 106.
        ...(k.spares_by_location ? {
          pills: k.spares_by_location.map((r) => ({
            text: `${r.location} (${r.spares})`,
            tone: "warn" as const,
            sortValue: r.spares,
          })),
          pillsEmpty: "no spares used",
        } : {
          lines: [
            { text: `${n(k.spare_games)} — games with spares` },
            { text: `${n(k.spare_appearances)} — spare appearances` },
          ],
        }),
        // Straight to the submitted games that had spares, over the season,
        // window and venue the count above covers.
        link: {
          href: `${APP_URL.stats_health}${k.games_with_spares_path ?? "/games?tab=submitted&spares=1"}`,
          label: "See games with spares →",
        },
      },
      {
        // A forfeited night is a night that did not happen: no stats to
        // collect, nothing recorded, and a venue full of people who turned up
        // for nothing. It was a figure in the corner of the card next door,
        // which is not where you look for the worst thing on the row.
        label: "Forfeits", value: k.forfeits == null ? "—" : n(k.forfeits),
        tone: k.forfeits ? "bad" : "ok",
        lines: [
          // Fewer forfeits is better, so the delta's colours invert.
          ...(k.prev_forfeits != null ? [{ text: `prev week ${n(k.prev_forfeits)}` }] : []),
          ...(fDelta != null ? [{ text: `${fDelta > 0 ? "+" : ""}${fDelta}`, color: upColor(-fDelta) }] : []),
        ],
        ...(k.forfeits_by_location ? {
          // Venue and night, because a venue is not one job: four forfeits at
          // Brooklyn (Bushwick) could be one night falling over four times or
          // four nights falling over once.
          pills: k.forfeits_by_location.map((r) => ({
            text: `${r.location}${r.day ? ` ${r.day}` : ""} (${r.forfeits})`,
            tone: "bad" as const,
            sortValue: r.forfeits,
          })),
          pillsEmpty: "no forfeits",
        } : {}),
      },
      // Under Stats completion rate (the next row starts here): games past the
      // window with no player stats — still waiting, or marked as having none.
      // The window comes from the feed, so the label always names it.
      ...(k.stats_overdue ? [((o) => ({
        label: `No stats after ${o.hours} hours`, value: n(o.total), tone: (o.total > 0 ? "bad" : "ok") as Tone,
        // A game either has stats by now or it doesn't — why it doesn't
        // (not yet submitted, or submitted without stats) isn't split out.
        lines: [
          { text: `of ${n(o.games)} games played ${o.hours}h+ ago · ${o.games ? Math.round((100 * o.total) / o.games) : 0}%`, strong: true },
        ],
        // Every venue with a game that old: red where any is missing stats.
        pills: o.by_location.map((r) => ({
          text: `${r.location} (${r.total})`,
          tone: (r.total > 0 ? "bad" : "ok") as Tone,
          sortValue: r.total,
        })),
        pillsEmpty: `no games ${o.hours}h old yet`,
        // Bottom right: the games themselves, in Stats Health.
        ...(o.path ? { link: { href: `${APP_URL.stats_health}${o.path}`, label: "More details →" } } : {}),
      }))(k.stats_overdue)] : []),
      // Beside it: games whose player points don't add up to the final score.
      ...(k.points_check ? [((p) => ({
        label: "Points don't add up", value: n(p.off), tone: (p.off > 0 ? "bad" : "ok") as Tone,
        // Out of the games with a box score to check; games with no player
        // stats have nothing to add up and stay off this card.
        lines: [
          { text: `${n(p.reconciled)} add up of ${n(p.checked)} games total · ${p.checked ? Math.round((100 * p.reconciled) / p.checked) : 0}%`, strong: true },
        ],
        pills: p.by_location.map((r) => ({
          text: `${r.location} ${r.off}/${r.checked}`,
          tone: (r.off > 0 ? "bad" : "ok") as Tone,
          sortValue: r.off,
        })),
        pillsEmpty: "no box scores to check",
        ...(p.path ? { link: { href: `${APP_URL.stats_health}${p.path}`, label: "More details →" } } : {}),
      }))(k.points_check)] : []),
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
// weekly: the week-over-week lines belong to Weekly Review. Every other section
// gets that for free — their feeds only return a previous week when asked for
// one — but the overdue app always sends its last snapshot, so this one has to
// decline it.
async function loadOverdueTiles(season: string, scope: Scope, weekly: boolean): Promise<Tile[] | null> {
  try {
    const url = new URL("/api/checkin-stats", "https://brodie-overdue-payments.vercel.app");
    url.searchParams.set("season", season);
    const lp = locParam(scope.locationNames); if (lp) url.searchParams.set("location", lp);
    // The overdue app only answers signed-in users since its hardening, plus
    // League Health with its feed key (LEAGUE_HEALTH_FEED_KEY there). The key
    // comes from the environment if set, else League Health's own app_secrets
    // table. Without it the section reads "not connected" — never sample data.
    const key = process.env.OVERDUE_FEED_KEY ?? (await readAppSecret("overdue_feed_key"));
    const res = await promoFetch(url.toString(), {
      cache: "no-store",
      headers: key ? { Authorization: `Bearer ${key}` } : undefined,
    });
    if (!res.ok) return null;
    const k = (await res.json()) as {
      currency_totals?: { cad: CurTotals; usd: CurTotals };
      overall?: { total_players: number; active_players: number; locations: number };
      locations?: {
        location: string; currency: string; players: number; total: number; checked_players: number;
        // Each active player's completed game dates ("YYYY-MM-DD", local wall
        // clock) for the team and season they owe on.
        active_players?: { game_dates?: string[] }[];
      }[];
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
    // The comparison is against the last snapshot the overdue app took, which
    // is not reliably a week back — Fall '26's was 26 days old — so the lines
    // name its date instead of calling it "prev week".
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const asOf = (iso?: string) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
      // Parsed by hand: `new Date("2026-09-12")` is UTC midnight and formats as
      // the 11th anywhere west of Greenwich.
      return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : "the last snapshot";
    };
    // Owing less is an improvement, so these deltas run the other way.
    const wowCount = (cur: number, prev: number | undefined, when: string) =>
      prev == null ? [] : [
        { text: `${prev.toLocaleString()} on ${when}` },
        // Said as a change, not as a figure: an unlabelled "0" under a line of
        // counts reads as "nothing is active" rather than "nothing moved".
        {
          text: cur === prev
            ? `no change since ${when}`
            : `${cur - prev > 0 ? "+" : "−"}${Math.abs(cur - prev).toLocaleString()} since ${when}`,
          color: upColor(-(cur - prev)),
        },
      ];
    // Compare what is still collectable — active players and their balance —
    // rather than the headline total, which includes people who have stopped
    // showing up. Owing less is an improvement, so the deltas run the other way.
    const wowActive = (
      c: CurTotals, cur: string,
      prev: { active_players: number; active_balance: number; total_players: number } | undefined,
      when: string,
    ) => {
      if (!prev) return [];
      const dBal = Math.round((c.active_balance - prev.active_balance) * 100) / 100;
      const dAct = c.active_players - prev.active_players;
      return [
        { text: `${prev.active_players} of ${prev.total_players} active · ${money(prev.active_balance, cur)} on ${when}` },
        {
          text: dAct === 0 && dBal === 0
            ? `no change since ${when}`
            : `${dAct > 0 ? "+" : dAct < 0 ? "−" : ""}${Math.abs(dAct)} active · ${dBal > 0 ? "+" : dBal < 0 ? "−" : ""}${money(Math.abs(dBal), cur)} since ${when}`,
          color: upColor(-dBal),
        },
      ];
    };
    const when = asOf(k.prev?.as_of);
    // ISO dates compare as strings, so the latest is a plain max.
    const lastGame = (players?: { game_dates?: string[] }[]) =>
      (players ?? []).flatMap((a) => a.game_dates ?? []).reduce<string | null>((m, d) => (!m || d > m ? d : m), null);
    // Which venues the debt is at. The feed already breaks itself down this
    // way; the cards were only ever showing the sum.
    const byLoc = [...(k.locations ?? [])].sort((a, b) => a.location.localeCompare(b.location));
    const tiles: Tile[] = [
      {
        label: "Total overdue players", value: ov.total_players.toLocaleString(), tone: ov.total_players > 0 ? "bad" : "ok",
        lines: [
          { text: `${ov.active_players.toLocaleString()} of ${ov.total_players.toLocaleString()} active`, strong: true },
          { text: `across ${ov.locations} location${ov.locations === 1 ? "" : "s"}` },
          ...(weekly ? wowCount(ov.total_players, k.prev?.total_players, when) : []),
        ],
        // Active out of overdue, per venue. A bare count of who owes does not
        // separate a venue chasing people who have stopped coming from one
        // whose debtors are on the court every week — red says somebody played
        // while owing, amber says the money is owed by people no longer
        // turning up.
        // Red chips also carry the latest night any of that venue's active
        // debtors played — how recently the money was last on the court.
        pills: byLoc.map((l) => {
          const last = lastGame(l.active_players);
          return {
            text: `${l.location} ${l.checked_players}/${l.players} (${l.players ? Math.round((100 * l.checked_players) / l.players) : 0}%)${last ? ` · last game ${asOf(last)}` : ""}`,
            tone: (l.checked_players > 0 ? "bad" : "warn") as Tone,
            sortValue: l.players,
          };
        }),
        pillsEmpty: "nobody overdue",
      },
    ];
    const card = (c: CurTotals, cur: string, label: string, prev?: { total_players: number; total_balance: number; active_players: number; active_balance: number }): Tile | null =>
      c.total_players === 0 ? null : {
        label, value: money(c.total_balance, cur),
        lines: [
          { text: `${c.total_players} player${c.total_players === 1 ? "" : "s"}`, strong: true },
          { text: `${money(c.active_balance, cur)} from active players` },
          { text: `${c.active_players} of ${c.total_players} players active` },
          ...(weekly ? wowActive(c, cur, prev, when) : []),
        ],
        // Only this card's own currency, so the two cards partition the venues
        // rather than each repeating all of them. Red where somebody has played
        // while owing: that is the balance still walking through the door.
        pills: byLoc
          .filter((l) => l.currency.toUpperCase() === cur)
          .map((l) => ({
            text: `${l.location} ${money(l.total, cur)} (${l.players})`,
            tone: (l.checked_players > 0 ? "bad" : "warn") as Tone,
            sortValue: l.total,
          })),
        pillsEmpty: "nothing outstanding",
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

// Teams one no-show from forfeiting: 6 or fewer fully paid players. Same feed
// and same rule as the overdue app's own Teams board, so the count on the card
// is the count on that page. The feed is org-wide, so the location filter is
// applied here rather than asked for.
const teamsHref = (season: string, location: string | null) => {
  const u = new URL("/teams", "https://brodie-overdue-payments.vercel.app");
  u.searchParams.set("season", season);
  if (location) u.searchParams.set("location", location);
  return u.toString();
};
async function loadForfeitTile(season: string, scope: Scope): Promise<Tile | null> {
  try {
    const url = new URL("/api/all-forfeit-risk", "https://brodie-overdue-payments.vercel.app");
    url.searchParams.set("season", season);
    const res = await promoFetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as { teams?: { location: string }[] };
    if (!k.teams) return null;
    const teams = scope.locationNames?.length
      ? k.teams.filter((t) => scope.locationNames!.some((n) => sameLocation(t.location, n)))
      : k.teams;
    const byLoc = new Map<string, number>();
    for (const t of teams) byLoc.set(t.location, (byLoc.get(t.location) ?? 0) + 1);
    return {
      label: "Teams at forfeit risk", value: teams.length.toLocaleString(),
      tone: teams.length > 0 ? "bad" : "ok",
      lines: [
        { text: `across ${byLoc.size} location${byLoc.size === 1 ? "" : "s"}`, strong: true },
        { text: "6 or fewer fully paid players" },
      ],
      // Every venue carrying any, worst first, so the list ranks itself and
      // the phone calls have an order. One tone, because there is no good
      // number here — a venue is on this list or it is not.
      pills: [...byLoc.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([location, n]) => ({ text: `${location} (${n})`, tone: "bad" as const, sortValue: n })),
      pillsEmpty: "no teams at risk",
      // The board opens on what the card is showing: the same season, and the
      // same venue where the filter has come down to exactly one of them. It
      // matches by exact name and has no multi-venue view, so a filter
      // spanning several (Brooklyn, Calgary) opens the cross-location board.
      link: { href: teamsHref(season, byLoc.size === 1 ? [...byLoc.keys()][0] : null), label: "More details →" },
    };
  } catch {
    return null;
  }
}

// The deadline the Promo Tracker is counting down to. Read rather than
// recomputed: the calendar of seasons, weeks and price tiers lives over there,
// and a second copy here would be a second copy to keep in step.
async function loadDeadlines(): Promise<DeadlineWeek[]> {
  try {
    const res = await promoFetch("https://registration-promo-tracker.vercel.app/api/next-deadline", { cache: "no-store" });
    if (!res.ok) return [];
    const k = (await res.json()) as { weeks?: DeadlineWeek[] };
    return k.weeks ?? [];
  } catch {
    return [];
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

// CRM outreach, measured exactly as the CRM's Team Registrations panel does:
// its own functions, read as its super admin sees them (every venue), summed
// over the venues with a team goal this season — the panel hides the rest.
//   pool       current + past captains at the venue (7 seasons)
//   contacted  pool captains with an outbound touch in the season's window
//   outcomes   contacted captains whose latest touch has an outcome logged
//   regAfter   contacted captains who registered after their first touch
// A count of messages or notes reads differently: 511 touches went to 474
// people, most of them not captains.
type FunnelRow = { location: string; pool: number; contacted: number; outcomes: number; regAfter: number; avgHours: number | null };
async function loadCaptainFunnel(scope: Scope, season?: string): Promise<{ season: string; total: FunnelRow; locations: FunnelRow[] } | null> {
  if (!sourceConfigured("crm")) return null;
  try {
    const sb = sourceClient("crm")!;
    const { data: seas } = await sb.from("seasons").select("key, p1_name, is_current");
    const seasons = (seas ?? []) as { key: string; p1_name: string | null; is_current: boolean }[];
    const hit = season
      ? seasons.find((x) => seasonKey(x.p1_name ?? x.key) === seasonKey(season))
      : seasons.find((x) => x.is_current);
    if (!hit) return null;
    const { data: admins } = await sb.from("managers").select("id")
      .eq("role", "super_admin").eq("active", true).order("created_at").limit(1);
    const managerId = (admins as { id: string }[] | null)?.[0]?.id;
    if (!managerId) return null;
    const [goals, funnel] = await Promise.all([
      sb.rpc("captain_progress_for_manager", { p_manager_id: managerId, p_season: hit.key }),
      sb.rpc("location_outreach_funnel", { p_manager_id: managerId, p_season: hit.key }),
    ]);
    if (goals.error || funnel.error) return null;
    const target = new Map<string, number>();
    for (const g of (goals.data ?? []) as { location_id: string; target: number | null }[]) {
      target.set(g.location_id, (target.get(g.location_id) ?? 0) + (g.target ?? 0));
    }
    const locations: FunnelRow[] = ((funnel.data ?? []) as {
      location_id: string; location_name: string;
      returning_captains_total: number | null; returning_captains_contacted: number | null;
      returning_captains_outcome_logged: number | null; returning_captains_registered_after_contact: number | null;
      returning_captains_avg_hours_to_register: number | string | null;
    }[])
      .filter((r) => (target.get(r.location_id) ?? 0) > 0)
      .filter((r) => !scope.locationNames || scope.locationNames.some((n) => sameLocation(n, r.location_name)))
      .map((r) => ({
        location: r.location_name,
        pool: r.returning_captains_total ?? 0,
        contacted: r.returning_captains_contacted ?? 0,
        outcomes: r.returning_captains_outcome_logged ?? 0,
        regAfter: r.returning_captains_registered_after_contact ?? 0,
        // numeric arrives as a string from PostgREST.
        avgHours: r.returning_captains_avg_hours_to_register == null ? null : Number(r.returning_captains_avg_hours_to_register),
      }))
      .sort((a, b) => a.location.localeCompare(b.location));
    const sum = (k: "pool" | "contacted" | "outcomes" | "regAfter") => locations.reduce((a, r) => a + r[k], 0);
    const regAfter = sum("regAfter");
    // Weighted by how many registered at each venue, as the CRM does.
    const hours = locations.reduce((a, r) => a + (r.avgHours != null ? r.avgHours * r.regAfter : 0), 0);
    return {
      season: hit.p1_name ?? hit.key,
      total: { location: "", pool: sum("pool"), contacted: sum("contacted"), outcomes: sum("outcomes"), regAfter, avgHours: regAfter > 0 ? hours / regAfter : null },
      locations,
    };
  } catch {
    return null;
  }
}
// The CRM's own wording: "1 day 2 hours".
function formatHours(h: number): string {
  const total = Math.round(h);
  if (total < 1) return "under an hour";
  const days = Math.floor(total / 24), hrs = total % 24;
  return [
    ...(days > 0 ? [`${days} ${days === 1 ? "day" : "days"}`] : []),
    ...(hrs > 0 ? [`${hrs} ${hrs === 1 ? "hour" : "hours"}`] : []),
  ].join(" ");
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
// Who is outstanding, by location. The training app's KPI feed is public and
// deliberately carries counts only — "no names, emails or per-person rows" —
// so the names are read straight from its database with the service-role
// connection this app already holds, and never leave a signed-in page.
//
// The assignment rule is the feed's, restated: a module is assigned by role or
// by an explicit assignment, minus anyone excused, and someone is outstanding
// when they have no completion row for it at all. Keeping the two in step is
// the price of naming names; the counts on the cards still come from the feed.
async function loadTrainingOutstanding(scope: Scope): Promise<Map<string, { loc: string; people: string[] }[]> | null> {
  if (!sourceConfigured("training")) return null;
  try {
    const sb = sourceClient("training")!;
    const [mods, roleLinks, explicitLinks, comps, exclusions, users, locs, userLocs] = await Promise.all([
      sb.from("modules").select("id, title, status").eq("status", "published"),
      sb.from("module_roles").select("module_id, role:roles!inner ( slug )"),
      sb.from("module_assignments").select("user_id, module_id"),
      sb.from("completions").select("user_id, module_id"),
      sb.from("module_exclusions").select("user_id, module_id"),
      sb.from("users").select("id, full_name, email, location_id, primary_role:roles!users_primary_role_id_fkey ( slug )").eq("status", "active"),
      sb.from("locations").select("id, name"),
      sb.from("user_locations").select("user_id, location_id"),
    ]);
    type U = { id: string; full_name: string | null; email: string | null; location_id: string | null;
      primary_role: { slug: string } | { slug: string }[] | null };
    const locName = new Map(((locs.data ?? []) as { id: string; name: string }[]).map((l) => [l.id, l.name]));
    // Every location someone covers, not just the primary one on their row.
    const covered = new Map<string, Set<string>>();
    for (const r of (userLocs.data ?? []) as { user_id: string; location_id: string }[]) {
      if (!covered.has(r.user_id)) covered.set(r.user_id, new Set());
      covered.get(r.user_id)!.add(r.location_id);
    }
    let userRows = (users.data ?? []) as U[];
    const locsOf = (u: U) => {
      const ids = [...(covered.get(u.id) ?? (u.location_id ? [u.location_id] : []))];
      return ids.map((id) => locName.get(id)).filter((n): n is string => !!n).sort();
    };
    if (scope.locationNames?.length) {
      userRows = userRows.filter((u) =>
        locsOf(u).some((n) => scope.locationNames!.some((w) => sameLocation(w, n))));
    }
    const roleOf = (u: U) => (Array.isArray(u.primary_role) ? u.primary_role[0] : u.primary_role)?.slug ?? null;
    const activeIds = new Set(userRows.map((u) => u.id));
    const rolesByModule = new Map<string, Set<string>>();
    for (const rl of (roleLinks.data ?? []) as { module_id: string; role: { slug: string } | { slug: string }[] | null }[]) {
      const r = (Array.isArray(rl.role) ? rl.role[0] : rl.role) ?? null;
      if (!r) continue;
      if (!rolesByModule.has(rl.module_id)) rolesByModule.set(rl.module_id, new Set());
      rolesByModule.get(rl.module_id)!.add(r.slug);
    }
    const excludedByModule = new Map<string, Set<string>>();
    for (const e of (exclusions.data ?? []) as { user_id: string; module_id: string }[]) {
      if (!excludedByModule.has(e.module_id)) excludedByModule.set(e.module_id, new Set());
      excludedByModule.get(e.module_id)!.add(e.user_id);
    }
    const out = new Map<string, { loc: string; people: string[] }[]>();
    for (const m of (mods.data ?? []) as { id: string; title: string }[]) {
      const slugs = rolesByModule.get(m.id) ?? new Set<string>();
      const excused = excludedByModule.get(m.id) ?? new Set<string>();
      const assigned = new Set(
        userRows.filter((u) => { const r = roleOf(u); return !!r && slugs.has(r) && !excused.has(u.id); }).map((u) => u.id),
      );
      for (const e of (explicitLinks.data ?? []) as { user_id: string; module_id: string }[]) {
        if (e.module_id === m.id && activeIds.has(e.user_id)) assigned.add(e.user_id);
      }
      const done = new Set(
        ((comps.data ?? []) as { user_id: string; module_id: string }[])
          .filter((c) => c.module_id === m.id).map((c) => c.user_id),
      );
      const byLoc = new Map<string, string[]>();
      for (const u of userRows) {
        if (!assigned.has(u.id) || done.has(u.id)) continue;
        const names = locsOf(u);
        // One row per person, filed under the first venue they cover, with the
        // rest in brackets. Listing them under each venue said the same thing
        // three times over and read as three people with the same name.
        const label = (u.full_name || u.email || "Unknown")
          + (names.length > 1 ? ` (${names.join(", ")})` : "");
        // Under a location filter, the first venue they cover THAT THE VIEW
        // ASKED FOR — otherwise someone covering Burnaby and Surrey would file
        // under Burnaby in a view scoped to Surrey alone.
        const visible = scope.locationNames?.length
          ? names.filter((n) => scope.locationNames!.some((w) => sameLocation(w, n)))
          : names;
        const home = (visible.length ? visible : names)[0] ?? "No location";
        if (!byLoc.has(home)) byLoc.set(home, []);
        byLoc.get(home)!.push(label);
      }
      out.set(m.title.toLowerCase(), [...byLoc.entries()]
        .sort((a, b) => (a[0] === "No location" ? 1 : 0) - (b[0] === "No location" ? 1 : 0) || a[0].localeCompare(b[0]))
        .map(([loc, people]) => ({ loc, people: people.sort((x, y) => x.localeCompare(y)) })));
    }
    return out;
  } catch {
    return null;
  }
}

async function loadTrainingTiles(scope: Scope): Promise<Tile[] | null> {
  try {
    const url = new URL("/api/dashboard-kpis", "https://brodie-training.vercel.app");
    const lp = locParam(scope.locationNames); if (lp) url.searchParams.set("location", lp);
    const res = await promoFetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as { modules?: ModuleRollup[] };
    const byTitle = new Map((k.modules ?? []).map((m) => [m.title.toLowerCase(), m]));
    const outstanding = await loadTrainingOutstanding(scope);
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
        ...(outstanding ? {
          pills: (outstanding.get(title.toLowerCase()) ?? [])
            .map((g) => ({ text: `${g.loc} — ${g.people.join(", ")}`, tone: "warn" as const, sortValue: g.people.length })),
          pillsEmpty: "everyone certified",
        } : {}),
      });
    }
    return tiles.length ? tiles : null;
  } catch {
    return null;
  }
}

type VenueRegs = { venue: string; day?: string | null; teams_registered: number; full_roster?: number; low_roster?: number; players?: number };
async function loadPromoTiles(season: string, scope: Scope): Promise<{ tiles: Tile[]; teamsRegistered: number; teamsFullRoster: number | null; byVenue: VenueRegs[] } | null> {
  try {
    const url = new URL("/api/dashboard-kpis", "https://registration-promo-tracker.vercel.app");
    url.searchParams.set("season", season);
    const lp = locParam(scope.locationNames); if (lp) url.searchParams.set("location", lp);
    const res = await promoFetch(url.toString(), { cache: "no-store" });
    if (res.status === 404) {
      // Season is beyond the promo horizon — registration hasn't opened.
      const zero: Tile[] = [
        { label: "Teams registered", value: "0", sub: `${season} — registration not open yet` },
        { label: "Stories posted", value: "0", unit: "/ 0", sub: "0%" },
        { label: "Highlights posted", value: "0", unit: "/ 0", sub: "0%" },
        { label: "Avg time to post", value: "—", sub: "0 posts" },
      ].map((x) => x) as Tile[];
      return { tiles: zero, teamsRegistered: 0, teamsFullRoster: null, byVenue: [] };
    }
    if (!res.ok) return null;
    const k = (await res.json()) as {
      teams_registered: number; teams_tracked?: number; teams_full_roster?: number | null; stories_posted: number; highlights_posted: number;
      story_pct: number; highlight_pct: number; story_tone?: Tone; highlight_tone?: Tone; avg_time_to_post_ms: number | null;
      avg_time_to_post_sample: number; locations: number; by_venue_day?: VenueRegs[];
      by_location?: {
        location: string; teams_tracked: number; stories_posted: number; highlights_posted: number;
        story_pct: number; highlight_pct: number; story_tone: Tone; highlight_tone: Tone;
        avg_time_to_post_ms: number | null; avg_time_to_post_sample: number; avg_time_tone: Tone | null;
      }[];
    };
    const fmt = (ms: number) => {
      const m = Math.floor(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
      return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${mm}m` : `${mm}m`;
    };
    // Posts are counted against the tracker's own list of teams, which is not
    // quite the registered-team count above it — that one is the ops DB. The
    // share has to be shown over the list it was measured on, or the fraction
    // and the percentage beside it disagree.
    const tracked = k.teams_tracked ?? k.teams_registered;
    // Each card broken down by the tracker's own locations, coloured by the
    // tracker's thresholds (95/80% for coverage; 6h/24h for time to post).
    // Absent until the tracker's feed carries by_location.
    const locs = k.by_location;
    const posts = (n: number) => `${n} post${n === 1 ? "" : "s"}`;
    const tiles: Tile[] = [
      { label: "Teams registered", value: k.teams_registered.toLocaleString(), sub: `across ${k.locations} locations` },
      {
        label: "Stories posted", value: `${k.stories_posted}`, unit: `/ ${tracked}`, sub: `${k.story_pct}%`, tone: k.story_tone ?? pctTone(k.story_pct),
        ...(locs ? {
          pills: locs.map((l) => ({ text: `${l.location} ${l.stories_posted}/${l.teams_tracked} (${l.story_pct}%)`, tone: l.story_tone, sortValue: l.stories_posted })),
          pillsEmpty: "no teams yet",
        } : {}),
      },
      {
        label: "Highlights posted", value: `${k.highlights_posted}`, unit: `/ ${tracked}`, sub: `${k.highlight_pct}%`, tone: k.highlight_tone ?? pctTone(k.highlight_pct),
        ...(locs ? {
          pills: locs.map((l) => ({ text: `${l.location} ${l.highlights_posted}/${l.teams_tracked} (${l.highlight_pct}%)`, tone: l.highlight_tone, sortValue: l.highlights_posted })),
          pillsEmpty: "no teams yet",
        } : {}),
      },
      {
        label: "Avg time to post", value: k.avg_time_to_post_ms != null ? fmt(k.avg_time_to_post_ms) : "—", sub: `${k.avg_time_to_post_sample} posts`, tone: "warn",
        // Slowest first under "Largest" — the venues keeping teams waiting.
        ...(locs ? {
          pills: locs.map((l) => l.avg_time_to_post_ms != null
            ? { text: `${l.location} ${fmt(l.avg_time_to_post_ms)} (${posts(l.avg_time_to_post_sample)})`, tone: l.avg_time_tone ?? "default", sortValue: l.avg_time_to_post_ms }
            : { text: `${l.location} no posts yet`, tone: "default" as Tone }),
          pillsEmpty: "no teams yet",
        } : {}),
      },
    ];
    return { tiles, teamsRegistered: k.teams_registered, teamsFullRoster: k.teams_full_roster ?? null, byVenue: k.by_venue_day ?? [] };
  } catch {
    return null;
  }
}

// Registration pacing (teams + athletes at "day N of registration" for this
// season vs the previous season vs a year ago) from the Promo Tracker feed.
// How old a season's athletes are where their profile carries a birth date,
// measured at the season's start. `n` is how many of them that was, so the
// figures are always read next to the share of the cohort they came from.
//
// The median leads, not the average: ages run with a long thin upper tail and
// no lower one, so a mean sits above the typical athlete by however many
// masters players a venue happens to carry — Ottawa means 25.8 against
// Vaughan's 24.6 while both have a median of 23. The average is kept for the
// hover, where it is a footnote rather than a ranking.
type AgeStats = {
  median: number | null; avg: number; under_24_pct: number; under_24?: number;
  n: number; coverage_pct: number | null; bands: { label: string; n: number }[];
};
type PacingSeason = { season: string; kind: string; captains: number; athletes: number; full_roster?: number; low_roster?: number; revenue?: number; revenue_native?: number; revenue_cad?: number; revenue_usd?: number; currency?: string; returning_captains_pct?: number | null; returning_athletes_pct?: number | null;
  // The counts behind those shares ("3 of 4 captains").
  returning_captains?: number | null; returning_captains_of?: number | null;
  returning_athletes?: number | null; returning_athletes_of?: number | null; age?: AgeStats | null;
  // age.median flattened onto the season by loadRegistrationPacing, so the age
  // card can go through the same bar machinery as every other metric.
  age_median?: number;
  // Teams, athletes and rosters per country, from the league's country.
  // Absent from an older feed or when the lookup failed.
  by_country?: Record<"CAN" | "USA", { captains: number; athletes: number; full_roster: number; low_roster: number; athletes_indiv?: number }>;
  // The per-athlete basis: athletes who paid for themselves and what that came
  // to, team fees left out — a captain paying the whole team on one invoice
  // pays for players who may not have joined yet. Absent from an older feed.
  athletes_indiv?: number; revenue_indiv_native?: number; revenue_indiv_cad?: number; revenue_indiv_usd?: number;
  // Retention (Registrations > Retention): of the season's registrants at day
  // N, who had played before — at the same venue or anywhere in Brodie, the
  // season before or in any of the four before. Only with ?retention=1.
  kept?: Kept; kept_by_country?: Record<"CAN" | "USA", Kept>;
  // The other direction (Retention: past players): of the players from the
  // season before, and from any of the four before, how many have registered
  // again by day N — back at the same venue, or anywhere. Only with ?back=1.
  back?: Back; back_by_country?: Record<"CAN" | "USA", Back>;
  // A country's revenue over its athletes, set on that country's projected
  // seasons only (countrySet). Undefined with no athletes to divide by.
  revenue_per_athlete?: number };
type Kept = {
  cap_total: number; cap_same_prev: number; cap_same_4: number; cap_any_prev: number; cap_any_4: number;
  ath_total: number; ath_same_prev: number; ath_same_4: number; ath_any_prev: number; ath_any_4: number;
  // Played Brodie in any earlier season, anywhere. Absent from an older feed.
  cap_ever?: number; ath_ever?: number;
};
// Players back from earlier seasons. _n is the cohort; _here back at a venue
// they played at, _any back anywhere. Captains count only when captaining.
type Back = {
  cap_prev_n: number; cap_prev_here: number; cap_prev_any: number;
  cap_4_n: number; cap_4_here: number; cap_4_any: number;
  ath_prev_n: number; ath_prev_here: number; ath_prev_any: number;
  ath_4_n: number; ath_4_here: number; ath_4_any: number;
  // The same term a year back (Winter '26 for Winter '27). Absent from an
  // older feed.
  cap_yr_n?: number; cap_yr_here?: number; cap_yr_any?: number;
  ath_yr_n?: number; ath_yr_here?: number; ath_yr_any?: number;
};
// "never" is the rest of the season's registrants: total less ever.
type KeptWindow = "same_prev" | "same_4" | "any_prev" | "any_4" | "ever" | "never";
function keptCount(k: Kept, pop: "cap" | "ath", w: KeptWindow): number | null {
  if (w === "ever" || w === "never") {
    const ever = k[`${pop}_ever`];
    return ever == null ? null : w === "ever" ? ever : k[`${pop}_total`] - ever;
  }
  return k[`${pop}_${w}`];
}
// A retention share to one decimal, or null with nobody to measure.
function keptPct(k: Kept | undefined, pop: "cap" | "ath", w: KeptWindow): number | null {
  const total = k ? k[`${pop}_total`] : 0;
  const n = k ? keptCount(k, pop, w) : null;
  return n != null && total ? Math.round((1000 * n) / total) / 10 : null;
}
type PacingMetric = "captains" | "athletes" | "full_roster" | "low_roster" | "revenue" | "revenue_native" | "revenue_cad" | "revenue_usd" | "age_median" | "revenue_per_athlete";
// Accrued registration revenue, already normalised to CAD by the feed. Whole
// dollars everywhere — cents are noise at this size.
const money = (n: number) => `${n < 0 ? "\u2212" : ""}$${Math.abs(Math.round(n)).toLocaleString()}`;
// Bars sit three to a card, so their labels abbreviate.
const moneyShort = (n: number) => {
  const a = Math.abs(n);
  const s = a >= 1_000_000 ? `${(a / 1_000_000).toFixed(2)}M` : a >= 1_000 ? `${Math.round(a / 1_000)}k` : `${Math.round(a)}`;
  return `${n < 0 ? "\u2212" : ""}$${s}`;
};
type Retention = { pct: number; prev_athletes: number; retained: number; prev_season: string; into_season?: string };
type PacingDivision = { name: string; teams: number; full_roster: number };
type PacingLocation = { location: string; country?: string; seasons: PacingSeason[]; divisions?: PacingDivision[]; retention?: Retention | null; retention_year?: Retention | null };
type Pacing = { day_n: number | null; elapsed_hours?: number | null; seasons: PacingSeason[]; locations?: PacingLocation[];
  retention?: Retention | null; retention_year?: Retention | null;
  // The team count’s own basis: captains who are captaining again.
  retention_captains?: Retention | null; retention_captains_year?: Retention | null };
// A discounts row for one card: a venue, or — on the single-venue view — one
// night at it, which carries `day`.
type CardDiscount = DiscountRow & { day?: string };
// The Discounts tab's rows for the location cards: per venue, or per night
// when the cards are nights. Season to date: the feed has no week cut.
async function loadLocationDiscounts(regSeason: string, scope: Scope, byNight: boolean): Promise<CardDiscount[] | null> {
  try {
    const url = new URL("/api/discounts", APP_URL.promo);
    url.searchParams.set("season", regSeason);
    if (byNight) url.searchParams.set("breakdown", "day");
    const lp = locParam(scope.locationNames); if (lp) url.searchParams.set("location", lp);
    const res = await promoFetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as { locations?: DiscountRow[]; by_day?: CardDiscount[] };
    return (byNight ? k.by_day : k.locations) ?? null;
  } catch {
    return null;
  }
}
// The pacing feed names a venue by its market where the discounts feed keeps
// the bracket ("Chicago" / "Chicago (Homer Glen)"), so fall back to the name
// without it — but only when that picks out one venue, never one of Boston's.
// A night card is named by its night, which the row carries as `day`.
function discountFor(location: string, rows: CardDiscount[], byNight: boolean): CardDiscount | undefined {
  if (byNight) return rows.find((r) => r.day === location);
  const norm = (x: string) => x.toLowerCase().replace(/\s+/g, " ").trim();
  const base = (x: string) => norm(x.replace(/\([^)]*\)/g, " "));
  const exact = rows.find((r) => norm(r.location) === norm(location));
  if (exact) return exact;
  const loose = rows.filter((r) => base(r.location) === base(location));
  return loose.length === 1 ? loose[0] : undefined;
}
async function loadRegistrationPacing(regSeason: string, scope: Scope, week?: string, retention = false, back = false): Promise<Pacing | null> {
  try {
    const url = new URL("/api/registration-pacing", "https://registration-promo-tracker.vercel.app");
    url.searchParams.set("season", regSeason);
    if (retention) url.searchParams.set("retention", "1");
    if (back) url.searchParams.set("back", "1");
    // Scoped to a single venue, the useful next cut is the nights it plays.
    url.searchParams.set("breakdown", scope.locationNames?.length === 1 ? "day" : "location");
    if (week) url.searchParams.set("week", week);
    const lp = locParam(scope.locationNames); if (lp) url.searchParams.set("location", lp);
    const res = await promoFetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as Pacing;
    // The feed reports age as an object; the cards chart plain numbers. Left
    // undefined rather than zeroed when a season has no birth dates at all —
    // a zero would draw as a real reading of "age 0".
    for (const s of k.seasons ?? []) s.age_median = s.age?.median ?? undefined;
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
    const res = await promoFetch(url.toString(), { cache: "no-store" });
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
    const res = await promoFetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as VideoReviewsData;
    return { weeks: k.weeks ?? [], by_location: k.by_location ?? [] };
  } catch {
    return null;
  }
}

const KIND_LABEL: Record<string, string> = { current: "this season", prev_season: "prev season", prev_year: "prev year" };
const REG_COLOR: Record<string, string> = { current: "var(--glass-gold)", prev_season: "#5B8AC4", prev_year: "#A874C9" };
const TRACK_PX = 130;
function RegBarCard({ title, subtitle, current, bars, notes, format = "number", bands, footer }: {
  title: string; subtitle: string; current: number;
  bars: { label: string; sub: string; value: number; color: string }[];
  // Retention, under the count it qualifies. Pinned to the foot of the card so
  // it lands in the same place on every card in the row, whatever height the
  // tallest one sets.
  footer?: ShareGroup[];
  // Second readings of the headline — how many of those teams can field a
  // side, and how many have barely started.
  notes?: { text: string; tone?: "bad" }[];
  format?: "number" | "money" | "age" | "percent";
  // Given a distribution, the card draws that instead of the season bars.
  // Three seasons of median age differ by a year at most, so as bars they
  // read as three identical blocks; the shape behind the median is the part
  // worth the space. The season comparison lives in the cards underneath.
  bands?: { label: string; n: number }[];
}) {
  // A median age is a whole year — the age of a real athlete in the middle of
  // the line — so it is not dressed up with a decimal it does not have.
  const fmtBig = (n: number) => (format === "money" ? money(n) : format === "age" ? String(Math.round(n)) : format === "percent" ? `${n.toFixed(1)}%` : n.toLocaleString());
  const fmtBar = (n: number) => (format === "money" ? moneyShort(n) : format === "age" ? String(Math.round(n)) : format === "percent" ? `${n.toFixed(1)}%` : n.toLocaleString());
  const max = Math.max(...bars.map((b) => b.value), 1);
  return (
    <div className="h-full flex flex-col rounded-2xl border border-glass-border bg-glass-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold" style={{ color: "var(--glass-text)" }}>{title}</h3>
          <p className="text-xs mt-0.5 text-glass-text-tertiary">{subtitle}</p>
        </div>
        <div className="text-right shrink-0">
          <span className="text-2xl font-bold tabular block" style={{ color: "var(--glass-gold)" }}>{fmtBig(current)}</span>
          {/* Chips, as on the location cards. Always two slots, the empty one
              held open, so the bars start at the same height on every card
              rather than one card's notes pushing them down. */}
          <div className="flex flex-col items-end gap-1 mt-0.5">
            {[0, 1].map((i) => {
              const n = notes?.[i];
              return (
                <span key={i} className="text-[11px] sm:text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap"
                  style={n
                    ? (n.tone === "bad"
                      ? { background: "rgba(239,68,68,0.14)", color: "rgb(248,113,113)" }
                      : { background: "var(--glass-gold-light, rgba(255,184,0,0.16))", color: "var(--glass-gold)" })
                    : { visibility: "hidden" }}>
                  {n ? n.text : "\u00A0"}
                </span>
              );
            })}
          </div>
        </div>
      </div>
      {bands ? <AgeBandRows bands={bands} roomy /> : (<>
      {/* Bars: fixed-px track so heights are truly proportional to value. */}
      <div className="flex items-end gap-6 mt-5" style={{ height: TRACK_PX + 22 }}>
        {bars.map((b, i) => (
          <div key={i} className="flex-1 flex flex-col items-center justify-end">
            <span className="text-sm font-semibold mb-1" style={{ color: "var(--glass-text)" }}>{fmtBar(b.value)}</span>
            <div className="w-full rounded-t-md" style={{ height: Math.max(Math.round((b.value / max) * TRACK_PX), 6), background: b.color }} />
          </div>
        ))}
      </div>
      <div className="flex gap-6 mt-2">
        {bars.map((b, i) => (
          <div key={i} className="flex-1 flex flex-col items-center">
            <span className="text-[11px] font-semibold text-glass-text-secondary">{b.label}</span>
            <span className="text-[11px] sm:text-[10px] uppercase tracking-wider text-glass-text-tertiary">{b.sub}</span>
          </div>
        ))}
      </div>
      </>)}
      {footer?.length ? <RegShareLines groups={footer} /> : null}
    </div>
  );
}

// The retention lines at the foot of a count card: what share of the people
// behind the number have been here before. Grouped rather than run together,
// because the two questions are asked of different populations — who
// registered this season, and who was here last season to come back — and four
// lines in a row read as one list of four shares. Same lines the location
// cards carry, so the two read the same way.
type ShareLine = {
  pct: number;
  // The head count behind the share, printed beside it: "75% · 3 of 4".
  count?: { n: number; of: number } | null;
  // Reads after the percentage: "of captains", "of SU'26 returned in F'26".
  text: string;
  // Movement against another season, in points — the difference of two
  // percentages is points, not a percentage of a percentage.
  deltas?: { value: number; label: string }[];
  title?: string;
};
type ShareGroup = { label?: string; lines: ShareLine[] };
function RegShareLines({ groups }: { groups: ShareGroup[] }) {
  return (
    <div className="mt-auto pt-2.5 border-t border-glass-border-light text-[11px] leading-snug">
      {groups.map((g, gi) => (
        <div key={gi} className={gi ? "mt-2" : ""}>
          {g.label && (
            <p className="text-[11px] sm:text-[10px] font-semibold uppercase tracking-wider text-glass-text-tertiary mb-0.5">
              {g.label}
            </p>
          )}
          {g.lines.map((l) => (
            <p key={l.text} title={l.title}>
              <span className="font-semibold" style={{ color: "var(--glass-text-secondary)" }}>{l.pct.toFixed(1)}%</span>
              <span className="text-glass-text-tertiary"> {l.text}</span>
              {l.count && (
                <span className="text-glass-text-tertiary tabular"> · {l.count.n.toLocaleString()} of {l.count.of.toLocaleString()}</span>
              )}
              {(l.deltas ?? []).map((d) => (
                <span key={d.label} className="text-[11px] sm:text-[10px] font-semibold" style={{ color: upColor(d.value) }}>
                  {" "}({d.value > 0 ? "+" : ""}{d.value.toFixed(1)} {d.label})
                </span>
              ))}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}

// Difference vs a comparison season at the same day of registration. Green =
// ahead of that season's pace, red = behind. null when the feed is missing a side.
function RegDeltaCard({ title, subtitle, delta, base, rosterDelta, rosterBase, format = "number", scored = false }: {
  title: string; subtitle: string; delta: number | null;
  // The comparison season's own figure, so the delta can be read as a share
  // as well as a count.
  base?: number | null;
  // The same comparison for teams that can field a side, which can move
  // very differently from the headline count.
  rosterDelta?: number | null;
  rosterBase?: number | null;
  format?: "number" | "money" | "points";
  // Points that have a good direction (retention up is good), coloured like a
  // count; age points stay neutral.
  scored?: boolean;
}) {
  // A share compared against a share moves in points, and the line underneath
  // carries the two shares themselves — a "+0.2" is unreadable without them.
  const isPoints = format === "points";
  const pct = isPoints
    ? (delta != null && base != null ? `${base.toFixed(1)}% \u2192 ${(base + delta).toFixed(1)}%` : null)
    : (delta != null && base ? signedPct(base + delta, base) : null);
  const rosterPct = rosterDelta != null && rosterBase ? signedPct(rosterBase + rosterDelta, rosterBase) : null;
  // Age has no good direction — a venue drifting older is who it serves, not
  // a result — so it is left in the plain text colour rather than scored
  // green or red like teams, athletes and revenue.
  const color =
    (isPoints && !scored) || delta === null || delta === 0 ? "var(--glass-text)" :
    delta > 0 ? "rgb(74,222,128)" : "rgb(248,113,113)";
  return (
    <div className="h-full rounded-2xl border border-glass-border bg-glass-surface p-4">
      {/* Sized to the narrowest these get — five columns, two cards to a
          column — so "Athletes vs prev season" reads in full rather than
          truncating to "Athletes vs prev ...". */}
      <h3 className="text-[11px] font-semibold truncate" title={title}
        style={{ color: "var(--glass-text)" }}>{title}</h3>
      <p className="text-[11px] sm:text-[10px] mt-0.5 text-glass-text-tertiary truncate" title={subtitle}>{subtitle}</p>
      {/* A size down from where this started: at five columns each card is
          about a third narrower than it was at four, and a money delta runs
          to nine characters before it clips. */}
      <p className="text-2xl font-bold tabular mt-2 whitespace-nowrap" style={{ color }}>
        {delta === null ? "—" : format === "money"
          ? `${delta > 0 ? "+" : ""}${money(delta)}`
          : isPoints
            ? `${delta > 0 ? "+" : ""}${delta.toFixed(1)}`
            : `${delta > 0 ? "+" : ""}${delta.toLocaleString()}`}
        {isPoints && <span className="text-sm font-normal text-glass-text-tertiary"> pts</span>}
      </p>
      <p className="text-[13px] font-semibold tabular" style={{ color }}>{pct ?? "\u00A0"}</p>
      {/* The line is reserved even when a metric has no roster figure, so
          every delta card is the same height as the ones beside it. */}
      {rosterDelta != null ? (
        // The count is the reading; its percentage no longer fits beside it at
        // a third of a column, so it moves to the hover along with the full
        // wording this line abbreviates.
        <p className="text-[11px] sm:text-[10px] font-semibold mt-1 tabular whitespace-nowrap" style={{ color: upColor(rosterDelta) }}
          title={`${rosterDelta > 0 ? "+" : ""}${rosterDelta.toLocaleString()} with 7 or more players${rosterPct ? ` (${rosterPct})` : ""}`}>
          {`${rosterDelta > 0 ? "+" : ""}${rosterDelta.toLocaleString()}`}
          <span className="font-normal text-glass-text-tertiary"> with 7+ players</span>
        </p>
      ) : (
        <p className="text-[11px] sm:text-[10px] mt-1" aria-hidden="true">&nbsp;</p>
      )}
    </div>
  );
}

const deltaColor = (d: number) =>
  d === 0 ? "var(--glass-text-secondary)" : d > 0 ? "rgb(74,222,128)" : "rgb(248,113,113)";
const signed = (d: number) => `${d > 0 ? "+" : ""}${d.toLocaleString()}`;
// Percent change against the comparison season. Null when that season had none
// of whatever is being counted — there is no percentage against zero.
const signedPct = (cur: number, base: number): string | null =>
  base === 0 ? null : `${cur - base > 0 ? "+" : ""}${(((cur - base) / base) * 100).toFixed(1)}%`;

// One metric column inside a location card: count + both same-day deltas.
function LocationMetric({ label, cur, prev, year, prevLabel, yearLabel, notes, money: isMoney }: {
  label: string; cur: number; prev: number; year: number; prevLabel: string; yearLabel: string;
  // Read under the deltas — how many of these teams can field a side, and how
  // many have barely started.
  notes?: { text: string; tone?: "gold" | "bad" }[];
  // Revenue reads as dollars; the counts do not.
  money?: boolean;
}) {
  const fmt = (n: number) => (isMoney ? money(n) : n.toLocaleString());
  const fmtDelta = (n: number) => (isMoney ? `${n > 0 ? "+" : ""}${money(n)}` : signed(n));
  const dPrev = cur - prev, dYear = cur - year;
  const pctPrev = signedPct(cur, prev), pctYear = signedPct(cur, year);
  return (
    <div className="min-w-0">
      <p className="text-[11px] sm:text-[10px] font-semibold uppercase tracking-wider text-glass-text-tertiary">{label}</p>
      <p className="text-2xl font-bold tabular leading-tight" style={{ color: "var(--glass-text)" }}>{fmt(cur)}</p>
      {/* The count and the share it moved by, then what it is measured against.
          Left to wrap rather than forced onto one line — the column is narrow
          and a clipped percentage is worse than a second line. */}
      {/* Money runs to twice the characters of a count, so it sets a size
          down and is free to wrap rather than run into the next column. */}
      <p className={`font-semibold mt-1 leading-snug ${isMoney ? "text-[11px] sm:text-[10px]" : "text-[11px] whitespace-nowrap"}`}
        style={{ color: deltaColor(dPrev) }}>
        {fmtDelta(dPrev)}
        <span className="font-normal text-glass-text-tertiary"> vs {prevLabel}</span>
        {pctPrev && <span className="text-[10px] sm:text-[9px] font-normal"> ({pctPrev})</span>}
      </p>
      <p className={`font-semibold leading-snug ${isMoney ? "text-[11px] sm:text-[10px]" : "text-[11px] whitespace-nowrap"}`}
        style={{ color: deltaColor(dYear) }}>
        {fmtDelta(dYear)}
        <span className="font-normal text-glass-text-tertiary"> vs {yearLabel}</span>
        {pctYear && <span className="text-[10px] sm:text-[9px] font-normal"> ({pctYear})</span>}
      </p>
      {/* Set as chips rather than more grey lines: they compete with the
          deltas above them and are the numbers worth reading twice. */}
      {!!notes?.length && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {notes.map((n) => (
            <span key={n.text} className="inline-block text-[11px] sm:text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap"
              style={n.tone === "bad"
                ? { background: "rgba(239,68,68,0.14)", color: "rgb(248,113,113)" }
                : { background: "var(--glass-gold-light, rgba(255,184,0,0.16))", color: "var(--glass-gold)" }}>
              {n.text}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// Warm for the young bands, cooling as they age, so a venue's skew reads off
// the bar before any label does. Fixed hex rather than theme tokens: these have
// to stay distinguishable from each other in both themes, which a ramp built
// out of one accent colour does not.
// Every band, in age order, whether or not anyone is in it: the rows land in
// the same place on every card, so a strip of venues can be read down as well
// as across. An empty band is a fact about the venue — no over-30s at all is
// worth seeing — so it holds its row rather than closing the gap.
//
// Bars run against the biggest band, not the total: scaled to the total, a
// venue's whole tail sits at one or two pixels and the rows stop saying
// anything about each other.
function AgeBandRows({ bands, roomy = false }: {
  bands: { label: string; n: number }[];
  // The Registrations card has a column to itself and can afford the larger
  // type; the location cards are 300px wide and cannot.
  roomy?: boolean;
}) {
  const total = bands.reduce((s, b) => s + b.n, 0);
  const max = Math.max(...bands.map((b) => b.n), 1);
  // A band holding someone is never shown as 0% — that reads as empty.
  const pctText = (n: number) => {
    const p = (n / total) * 100;
    return p < 0.5 ? "<1" : p.toFixed(0);
  };
  return (
    // On the Registrations card the rows spread to fill the height the bar
    // charts beside them occupy, so the column does not end in dead space.
    <div className={roomy ? "mt-4 flex-1 flex flex-col justify-between" : "mt-1.5 space-y-[2px]"}
      title="Age at season start">
      {bands.map((b, i) => (
        <div key={b.label} className="flex items-center gap-1.5">
          <span className={`${roomy ? "text-[11px] w-[58px]" : "text-[11px] sm:text-[10px] w-[52px]"} shrink-0 tabular whitespace-nowrap`}
            style={{ color: b.n ? "var(--glass-text-secondary)" : "var(--glass-text-tertiary)" }}>
            {b.label}
          </span>
          <span className="flex-1 min-w-0 flex items-center">
            <span className={`${roomy ? "h-1.5" : "h-1"} rounded-full`}
              style={{ width: `${(b.n / max) * 100}%`, background: AGE_COLORS[i] }} />
          </span>
          <span className={`${roomy ? "text-[11px] w-[42px]" : "text-[11px] sm:text-[10px] w-[36px]"} tabular font-semibold text-right shrink-0`}
            style={{ color: b.n ? "var(--glass-text)" : "var(--glass-text-tertiary)" }}>
            {b.n.toLocaleString()}
          </span>
          <span className={`${roomy ? "text-[11px] sm:text-[10px] w-[28px]" : "text-[10px] sm:text-[9px] w-[24px]"} tabular text-right shrink-0 text-glass-text-tertiary`}>
            {b.n ? `${pctText(b.n)}%` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}
const AGE_COLORS = [
  "#E8C468", // Under 18
  "#F0B429", // 18–23
  "#E08A4C", // 24–29
  "#C4707E", // 30–34
  "#9A73B5", // 35–39
  "#6D82C4", // 40–44
  "#4E9AA8", // 45–49
  "#5D9E80", // 50+
];
// How old this venue's athletes are: the typical one, how the intake moved,
// and the shape behind both. A single number hides the difference between a
// venue that is evenly 25 and one that is half students and half
// thirty-somethings, so the bands are drawn too.
//
// The movement line is the share under 24 rather than the median itself. A
// median is whole years, so it jumps a full year either way on a fractional
// shift across the midpoint and sits still through everything else — Fall '25
// to Fall '26 reads a year younger on the median while the under-24 share
// moved two tenths of a point. The share moves when the intake moves.
//
// Deltas are deliberately not coloured green/red like the rest of the card.
// Every other metric here has a direction — more teams good, less revenue bad —
// and age does not: a venue drifting older is a fact about who it serves, not
// a fall in performance, and painting it red would assert otherwise.
const SMALL_AGE_SAMPLE = 5;
// Athletes under 24, read off the bands when the feed doesn't send the count.
const underTwentyFour = (bands: { label: string; n: number }[]) =>
  bands.filter((b) => b.label === "Under 18" || b.label.startsWith("18")).reduce((n, b) => n + b.n, 0);
function LocationAge({ age, prev, year, prevLabel, yearLabel, athletes }: {
  age: AgeStats; prev?: AgeStats | null; year?: AgeStats | null;
  prevLabel: string; yearLabel: string;
  // This season's athletes at the venue, for "11 of 13 on file".
  athletes?: number | null;
}) {
  const total = age.bands.reduce((s, b) => s + b.n, 0);
  if (total === 0) return null;
  // Under five birth dates the block still shows — a new venue's first
  // athletes are worth seeing — but says how few it rests on, and drops the
  // change against earlier seasons: one person moves a share of three by 33
  // points, which would read as a trend.
  const small = total < SMALL_AGE_SAMPLE;
  const drift = (other: AgeStats | null | undefined, label: string) =>
    small || !other ? null : (
      <span key={label} className="text-[10px] sm:text-[9px] font-semibold whitespace-nowrap"
        style={{ color: "var(--glass-text-secondary)" }}>
        {" "}{age.under_24_pct - other.under_24_pct > 0 ? "+" : age.under_24_pct - other.under_24_pct < 0 ? "−" : ""}
        {Math.abs(age.under_24_pct - other.under_24_pct).toFixed(1)}
        <span className="font-normal text-glass-text-tertiary"> vs {label}</span>
      </span>
    );
  return (
    <div className="mt-2.5 pt-2.5 border-t border-glass-border-light">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] sm:text-[10px] font-semibold uppercase tracking-wider text-glass-text-tertiary">Age</p>
        {age.coverage_pct != null && (
          <p className="text-[10px] sm:text-[9px] text-glass-text-tertiary shrink-0"
            title={`${age.n.toLocaleString()} of this season's athletes have a birth date on file`}>
            {age.coverage_pct}% on file
            {athletes != null && <span className="tabular"> · {age.n} of {athletes}</span>}
          </p>
        )}
      </div>
      {small && (
        <p className="mt-0.5 text-[10px] sm:text-[9px] italic leading-snug text-glass-text-tertiary">
          Based on {total} athlete{total === 1 ? "" : "s"} — too few to read much into
        </p>
      )}
      <p className="mt-0.5 text-[11px] leading-snug" title={`Average ${age.avg.toFixed(1)}`}>
        <span className="text-sm font-bold tabular" style={{ color: "var(--glass-text)" }}>
          {age.median ?? "—"}
        </span>
        <span className="text-glass-text-tertiary"> median</span>
      </p>
      {/* The line that actually moves, and what moved it. Points, not percent:
          the difference between two shares is points. */}
      <p className="text-[11px] leading-snug">
        <span className="font-semibold tabular" style={{ color: "var(--glass-text-secondary)" }}>
          {age.under_24_pct.toFixed(1)}%
        </span>
        <span className="text-glass-text-tertiary"> under 24</span>
        <span className="text-glass-text-tertiary tabular"> · {(age.under_24 ?? underTwentyFour(age.bands))} of {total}</span>
        {drift(prev, prevLabel)}
        {drift(year, yearLabel)}
      </p>
      {/* Every band, in age order, whether or not anyone is in it: the rows
          land in the same place on every card, so a strip of venues can be
          read down as well as across. An empty band is a fact about the venue
          — no over-30s at all is worth seeing — so it holds its row rather
          than closing the gap. */}
      <AgeBandRows bands={age.bands} />
    </div>
  );
}

// The two movements side by side per location, against both comparison
// seasons. A scatter of the same numbers put every venue on the diagonal —
// true, but it hides the values; paired bars let you read each one and see
// where they part company.
// Roster health, on the location cards and the per-night chips alike: 8.5+ is
// a full side with cover, 7.5+ can field one, below that cannot.
const ROSTER_OK = 8.5, ROSTER_WARN = 7.5;
const rosterColor = (avg: number | null) =>
  avg === null ? "var(--glass-text-secondary)"
    : avg >= ROSTER_OK ? "rgb(74,222,128)"
      : avg >= ROSTER_WARN ? "var(--glass-gold)"
        : "rgb(248,113,113)";
const rosterChipStyle = (avg: number) =>
  avg >= ROSTER_OK
    ? { color: "rgb(74,222,128)", borderColor: "rgba(74,222,128,0.35)", background: "rgba(74,222,128,0.10)" }
    : avg >= ROSTER_WARN
      ? { color: "var(--glass-gold)", borderColor: "rgba(255,184,0,0.35)", background: "rgba(255,184,0,0.10)" }
      : { color: "rgb(248,113,113)", borderColor: "rgba(239,68,68,0.35)", background: "rgba(239,68,68,0.10)" };

const ATH_COLOR = "#5B8AC4";
function AthletesVsRevenueChart({ locations, prevLabel, yearLabel }: {
  locations: PacingLocation[]; prevLabel: string; yearLabel: string;
}) {
  type Pair = { ath: number | null; rev: number | null };
  type Row = { location: string; prev: Pair; year: Pair };
  const pct = (cur: number, base: number | undefined | null) =>
    base ? ((cur - base) / base) * 100 : null;
  const rows: Row[] = locations.map((l) => {
    const c = l.seasons.find((s) => s.kind === "current");
    const p = l.seasons.find((s) => s.kind === "prev_season");
    const y = l.seasons.find((s) => s.kind === "prev_year");
    return {
      location: l.location,
      prev: { ath: pct(c?.athletes ?? 0, p?.athletes), rev: pct(c?.revenue_native ?? 0, p?.revenue_native) },
      year: { ath: pct(c?.athletes ?? 0, y?.athletes), rev: pct(c?.revenue_native ?? 0, y?.revenue_native) },
    };
  });
  if (!rows.length) return null;
  // Venues with nothing to compare against sort to the bottom rather than
  // dropping out — they are still locations, they are just new.
  rows.sort((a, b) =>
    (a.prev.rev === null ? 1 : 0) - (b.prev.rev === null ? 1 : 0) ||
    (b.prev.rev ?? -Infinity) - (a.prev.rev ?? -Infinity));

  const RH = 32, W = 1000, PAD = { l: 168, t: 48, b: 24 }, GAP = 44;
  const H = PAD.t + PAD.b + RH * rows.length;
  const panel = (W - PAD.l - GAP - 8) / 2;
  const all = rows.flatMap((r) => [r.prev.ath, r.prev.rev, r.year.ath, r.year.rev])
    .filter((v): v is number => v !== null).map(Math.abs);
  // One scale across both panels, so a bar means the same thing on either side.
  const span = Math.max(20, Math.ceil(Math.max(...all, 20) / 20) * 20);
  const panels = [
    { title: `vs ${prevLabel}`, key: "prev" as const },
    { title: `vs ${yearLabel}`, key: "year" as const },
  ];
  const zeroX = (i: number) => PAD.l + i * (panel + GAP) + panel / 2;
  const scale = (panel / 2) / span;

  return (
    <div className="rounded-2xl border border-glass-border bg-glass-surface p-5 overflow-x-auto">
      <h3 className="text-base font-semibold" style={{ color: "var(--glass-text)" }}>Athletes and revenue per location</h3>
      <p className="text-xs mt-0.5 text-glass-text-tertiary">
        % change · <span style={{ color: ATH_COLOR }}>athletes</span>
        {" "}and <span style={{ color: "var(--glass-gold)" }}>revenue</span>, each venue in its own currency
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full mt-3" style={{ minWidth: 720 }} role="img"
        aria-label={`Percent change in athletes and revenue for each location, against ${prevLabel} and ${yearLabel}`}>
        {panels.map((p, pi) => (
          <g key={p.key}>
            <text x={zeroX(pi)} y={PAD.t - 28} textAnchor="middle" fontSize={12} fontWeight={600}
              fill="var(--glass-text)">{p.title}</text>
            {[-span, -span / 2, 0, span / 2, span].map((v) => (
              <g key={v}>
                <line x1={zeroX(pi) + v * scale} y1={PAD.t - 12} x2={zeroX(pi) + v * scale} y2={H - PAD.b}
                  stroke="var(--glass-border-light)" strokeWidth={1} />
                {/* Only the inner ticks are labelled — the outermost pair
                    collides across the gap between the panels. */}
                {Math.abs(v) !== span && (
                  <text x={zeroX(pi) + v * scale} y={PAD.t - 16} textAnchor="middle" fontSize={10}
                    fill="var(--glass-text-tertiary)">{v}%</text>
                )}
              </g>
            ))}
            <line x1={zeroX(pi)} y1={PAD.t - 12} x2={zeroX(pi)} y2={H - PAD.b}
              stroke="var(--glass-border)" strokeWidth={1.4} />
          </g>
        ))}
        {rows.map((r, i) => {
          const y = PAD.t + i * RH;
          return (
            <g key={r.location}>
              <text x={PAD.l - 12} y={y + RH / 2 + 4} textAnchor="end" fontSize={12}
                fill="var(--glass-text)">{r.location}</text>
              {panels.map((p, pi) => {
                const pair = r[p.key];
                if (pair.ath === null && pair.rev === null) {
                  return (
                    <text key={p.key} x={zeroX(pi)} y={y + RH / 2 + 4} textAnchor="middle" fontSize={10}
                      fill="var(--glass-text-tertiary)">no {p.title.replace("vs ", "")} season</text>
                  );
                }
                return ([[pair.ath, ATH_COLOR], [pair.rev, "var(--glass-gold)"]] as const).map(([v, color], j) =>
                  v === null ? null : (
                    <g key={`${p.key}${j}`}>
                      <rect x={Math.min(zeroX(pi), zeroX(pi) + v * scale)} y={y + 4 + j * 10}
                        width={Math.max(Math.abs(v * scale), 1.5)} height={8} rx={2} fill={color} />
                      <text x={zeroX(pi) + v * scale + (v >= 0 ? 4 : -4)} y={y + 11.5 + j * 10}
                        textAnchor={v >= 0 ? "start" : "end"} fontSize={9} fill={color}>
                        {v > 0 ? "+" : ""}{v.toFixed(0)}%
                      </text>
                    </g>
                  ));
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// Each of these owns a single source app. Rendered inside its own Suspense
// boundary they start together and appear as they answer, so the page fills
// top to bottom instead of waiting for the slowest one.
async function OutreachCards({ scope, season, fullTag }: { scope: Scope; season?: string; fullTag?: string }) {
  const f = await loadCaptainFunnel(scope, season);
  const pct = (n: number, of: number) => (of ? Math.round((100 * n) / of) : 0);
  const chips = (text: (r: FunnelRow) => string | null, sortValue: (r: FunnelRow) => number) =>
    (f?.locations ?? []).flatMap((r) => {
      const t = text(r);
      return t ? [{ text: t, tone: "default" as Tone, sortValue: sortValue(r) }] : [];
    });
  const tiles: Tile[] | null = f ? [
    {
      label: "Captains contacted", value: f.total.contacted.toLocaleString(), unit: `/ ${f.total.pool.toLocaleString()}`,
      sub: `${pct(f.total.contacted, f.total.pool)}% of captain pool`, tone: "warn",
      pills: chips((r) => `${r.location} ${r.contacted}/${r.pool} (${pct(r.contacted, r.pool)}%)`, (r) => r.contacted),
      pillsEmpty: "no captain pool in scope",
    },
    {
      label: "Outcomes logged", value: f.total.outcomes.toLocaleString(), unit: `/ ${f.total.contacted.toLocaleString()}`,
      sub: `${pct(f.total.outcomes, f.total.contacted)}% of contacted`, tone: "warn",
      pills: chips((r) => r.contacted ? `${r.location} ${r.outcomes}/${r.contacted} (${pct(r.outcomes, r.contacted)}%)` : null, (r) => r.outcomes),
      pillsEmpty: "nobody contacted yet",
    },
    {
      label: "Registered after contact", value: f.total.regAfter.toLocaleString(), unit: `/ ${f.total.contacted.toLocaleString()}`,
      sub: `${pct(f.total.regAfter, f.total.contacted)}% of contacted`, tone: "ok",
      pills: chips((r) => r.contacted ? `${r.location} ${r.regAfter}/${r.contacted} (${pct(r.regAfter, r.contacted)}%)` : null, (r) => r.regAfter),
      pillsEmpty: "nobody contacted yet",
    },
    {
      label: "Avg time to register", value: f.total.avgHours == null ? "—" : formatHours(f.total.avgHours),
      sub: f.total.regAfter ? `after first touch (${f.total.regAfter} captain${f.total.regAfter === 1 ? "" : "s"})` : "nobody registered after contact yet",
      tone: f.total.avgHours == null ? "default" : "ok",
      // Slowest first under "Largest".
      pills: chips((r) => r.avgHours != null && r.regAfter ? `${r.location} ${formatHours(r.avgHours)} (${r.regAfter})` : null, (r) => r.avgHours ?? 0),
      pillsEmpty: "nobody registered after contact yet",
    },
  ] : null;
  // Season to date whatever the week filter says: the CRM measures the
  // season's registration window.
  return <Section title="Outreach" scopeTag={fullTag} seasonTag={f ? `${f.season} registration` : undefined}
    href={APP_URL.crm} tiles={tiles} cols={4} />;
}
async function SiteVisitCards({ scope, weeks, weekTag }: { scope: Scope; weeks?: string; weekTag?: string }) {
  const d = await loadSiteVisits(scope, weeks);
  return d && d.weeks.length > 0 ? <SiteVisitsSection data={d} titleSuffix={weekTag} /> : null;
}
async function VideoReviewCards({ scope, weeks, weekTag }: { scope: Scope; weeks?: string; weekTag?: string }) {
  const d = await loadVideoReviews(scope, weeks);
  return d && d.weeks.length > 0 ? <VideoReviewsSection data={d} titleSuffix={weekTag} /> : null;
}
async function GameDayCards({ scope, season, weeks, tag }: {
  scope: Scope; season: string; weeks: string[]; tag?: string;
}) {
  const tiles = await loadGameDayTiles(scope, season, weeks);
  return tiles
    ? <Section title="LM Game Day Checklist" scopeTag={tag}
        href={`${APP_URL.checklist}/checklists?kind=lm_game_day`} tiles={tiles} cols={4} />
    : null;
}
async function TrainingCards({ scope, fullTag }: { scope: Scope; fullTag?: string }) {
  const tiles = await loadTrainingTiles(scope);
  return tiles ? <Section title="Training" scopeTag={fullTag} href={APP_URL.training} tiles={tiles} /> : null;
}
async function StatsHealthCards({ season, scope, weeks, weekTag }: { season: string; scope: Scope; weeks?: string; weekTag?: string }) {
  const tiles = await loadStatsTiles(season, scope, weeks);
  return <Section title="Stats Health" scopeTag={weekTag} href={APP_URL.stats_health}
    tiles={tiles} emptyNote="Not tracked for the selected locations." />;
}
async function ContentHealthCards({ season, scope, weeks, weekTag }: { season: string; scope: Scope; weeks?: string; weekTag?: string }) {
  const tiles = await loadContentTiles(season, scope, weeks);
  return <Section title="Content Health" scopeTag={weekTag} href={APP_URL.content_health}
    tiles={tiles} emptyNote="Not tracked for the selected locations." />;
}
async function FeedbackCards({ season, scope, fullTag }: { season: string; scope: Scope; fullTag?: string }) {
  const tiles = await loadFeedbackTiles(season, scope);
  return <Section title="Feedback" scopeTag={fullTag} href={APP_URL.feedback}
    tiles={tiles} />;
}
async function OverdueCards({ season, scope, fullTag, weekly = false, nextSeason, onNext = false }: {
  season: string; scope: Scope; fullTag?: string; weekly?: boolean;
  // The season being registered for. Debt builds there before it is anyone's
  // job to chase it, so the section can be read either way round.
  nextSeason?: string; onNext?: boolean;
}) {
  const shown = onNext && nextSeason ? nextSeason : season;
  const [tiles, forfeit] = await Promise.all([
    loadOverdueTiles(shown, scope, weekly),
    loadForfeitTile(shown, scope),
  ]);
  // Only alongside the real figures — hung off the sample set it would read as
  // one live number among three invented ones.
  const all = tiles && forfeit ? [...tiles, forfeit] : tiles;
  return <Section title="Overdue Payments" scopeTag={fullTag} href={APP_URL.overdue}
    tiles={all}
    headerExtra={nextSeason && nextSeason !== season ? (
      <BasisToggle
        param="overdueSeason"
        value={onNext ? "next" : "current"}
        options={[{ value: "current", label: season }, { value: "next", label: nextSeason }]}
      />
    ) : undefined} />;
}
async function BookingCards({ season, scope, fullTag, promo, promoSeason, locationNames, headerExtra }: {
  season: string; scope: Scope; fullTag?: string;
  // The Promo Tracker section's figures, and the season they were fetched for.
  // The two sections toggle independently, so this one refetches rather than
  // counting one season's teams against another season's bookings.
  promo: Awaited<ReturnType<typeof loadPromoTiles>>; promoSeason: string;
  locationNames: string[] | null; headerExtra?: ReactNode;
}) {
  const [b, p] = await Promise.all([
    loadBookings(season, scope),
    season === promoSeason ? Promise.resolve(promo) : loadPromoTiles(season, scope),
  ]);
  return b ? <BookingsSection data={b} season={season} titleSuffix={fullTag}
    teamsRegistered={p?.teamsRegistered} teamsFullRoster={p?.teamsFullRoster}
    venueRegs={p?.byVenue} scopeLocations={locationNames} headerExtra={headerExtra} /> : null;
}

// The Discounts tab's three rates for one venue, in its own currency and on
// its own colour rules. Each label opens that venue's drill-down.
function LocationDiscounts({ row, season, seasonToDate }: { row: DiscountRow; season: string; seasonToDate: boolean }) {
  const cents = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const href = (extra: Record<string, string>) =>
    `/discounts/players?${new URLSearchParams({ season, location: row.location, ...extra })}`;
  const items = [
    { label: "Got a discount", n: row.discounted, cost: row.discount_total ?? 0, tone: discountTone, href: href({}) },
    ...(row.other_discounted != null ? [{
      label: "Other discounts", n: row.other_discounted, cost: row.other_discount_total ?? 0, tone: discountTone,
      href: href({ kind: "other" }),
    }] : []),
    { label: "Free", n: row.free, cost: row.free_value ?? 0, tone: freeTone, href: href({ free: "1" }) },
  ];
  return (
    <div className="mt-2.5 pt-2.5 border-t border-glass-border-light text-[11px] leading-snug">
      <div className="flex items-baseline gap-2 text-[10px] font-semibold uppercase tracking-wider text-glass-text-tertiary mb-1">
        <span className="flex-1 min-w-0 truncate">Discounts ({row.currency.toUpperCase()})</span>
        <span className="shrink-0 w-16 text-right">Players</span>
        <span className="shrink-0 w-[4.25rem] text-right">Given up</span>
      </div>
      {items.map((it) => {
        const pct = (100 * it.n) / row.regs;
        return (
          <div key={it.label} className="flex items-baseline gap-2">
            <a href={it.href} className="flex-1 min-w-0 truncate text-glass-text-secondary hover:text-glass-text hover:underline">
              {it.label}
            </a>
            <span className="shrink-0 tabular font-semibold" style={{ color: it.tone(pct) }}>{Math.round(pct)}%</span>
            <span className="shrink-0 w-16 text-right tabular text-glass-text-tertiary">{it.n} of {row.regs}</span>
            <span className="shrink-0 w-[4.25rem] text-right tabular" style={{ color: "var(--glass-text-secondary)" }}>{cents(it.cost)}</span>
          </div>
        );
      })}
      {(() => {
        const notes = [
          ...(row.other_discounted != null ? ["Other = not returning player or referral"] : []),
          ...(seasonToDate ? ["season to date"] : []),
        ];
        return notes.length ? <p className="mt-1 text-[10px] text-glass-text-tertiary">{notes.join(" · ")}</p> : null;
      })()}
    </div>
  );
}

// The retention tabs' location cards: blocks of shares, each row a captains
// share and an athletes share with its count and its same-day change against
// the previous season and the previous year. The tabs supply what each row
// reads, so both use one card.
type ShareRow = {
  label: string;
  // Changes with no good direction (newcomers) stay neutral.
  neutral?: boolean;
  get: (x?: PacingSeason, pop?: "cap" | "ath") => { n: number; of: number } | null;
};
type ShareBlock = { label: string; rows: ShareRow[] };
function ShareStrip({ locations, blocks, head, byNight = false, prevLabel, yearLabel }: {
  locations: PacingLocation[]; blocks: ShareBlock[]; head: (x?: PacingSeason) => string;
  byNight?: boolean; prevLabel: string; yearLabel: string;
}) {
  const fmtPts = (d: number) => `${d > 0 ? "+" : d < 0 ? "\u2212" : ""}${Math.abs(d).toFixed(1)}`;
  const pct = (v: { n: number; of: number } | null) => (v && v.of ? Math.round((1000 * v.n) / v.of) / 10 : null);
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-glass-text-tertiary mb-2">
        {byNight ? "By night" : "By location"}
      </h3>
      <div className="grid grid-flow-col auto-cols-[300px] gap-x-3 overflow-x-auto pb-2 snap-x">
        {locations.map((l) => {
          const at = (kind: string) => l.seasons.find((x) => x.kind === kind);
          const cur = at("current"), prev = at("prev_season"), yr = at("prev_year");
          return (
            <div key={l.location} className="snap-start rounded-xl border border-glass-border bg-glass-surface px-3.5 py-3.5">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-xs font-semibold truncate" style={{ color: "var(--glass-text)" }} title={l.location}>{l.location}</p>
                <p className="text-[11px] text-glass-text-tertiary tabular shrink-0 truncate">{head(cur)}</p>
              </div>
              {blocks.map((b) => (
                <div key={b.label} className="mt-2.5 pt-2.5 border-t border-glass-border-light">
                  <div className="flex items-baseline gap-2 text-[10px] font-semibold uppercase tracking-wider text-glass-text-tertiary mb-1">
                    <span className="flex-1 min-w-0 truncate">{b.label}</span>
                    <span className="shrink-0 w-[5.5rem] text-right">Captains</span>
                    <span className="shrink-0 w-[5.5rem] text-right">Athletes</span>
                  </div>
                  {b.rows.map((row) => (
                    <div key={row.label} className="flex items-start gap-2 text-[11px] leading-snug py-1">
                      <span className="flex-1 min-w-0 text-glass-text-secondary">{row.label}</span>
                      {(["cap", "ath"] as const).map((pop) => {
                        const now = row.get(cur, pop);
                        const v = pct(now), pv = pct(row.get(prev, pop)), yv = pct(row.get(yr, pop));
                        return (
                          <span key={pop} className="shrink-0 w-[5.5rem] text-right tabular">
                            <span className="block font-semibold" style={{ color: "var(--glass-text)" }}>{v == null ? "—" : `${v.toFixed(1)}%`}</span>
                            <span className="block text-[10px] text-glass-text-tertiary">{now ? `${now.n} of ${now.of}` : "\u00A0"}</span>
                            {([[pv, prevLabel], [yv, yearLabel]] as const).map(([base, lbl]) =>
                              v != null && base != null ? (
                                <span key={lbl} className="block text-[10px] font-semibold"
                                  style={{ color: row.neutral ? "var(--glass-text-secondary)" : upColor(v - base) }}>
                                  {fmtPts(Math.round((v - base) * 10) / 10)} vs {lbl}
                                </span>
                              ) : null)}
                          </span>
                        );
                      })}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Horizontally scrolling strip of per-location cards. Each card carries both
// teams and athletes so a location reads as one unit instead of forcing you to
// scroll two rows in sync to compare them.
function LocationStrip({ locations, prevLabel, yearLabel, season, showAvgPerTeam = true, byNight = false, venue, discounts, discountsSeasonToDate = false }: {
  locations: PacingLocation[];
  // The one venue the by-night cards are nights of.
  venue?: string;
  // The Discounts tab's rows — per venue, or per night on the by-night cards;
  // null when the feed is down.
  discounts?: CardDiscount[] | null;
  // The cards are on a week basis but discounts can only be season to date.
  discountsSeasonToDate?: boolean;
  prevLabel: string;
  yearLabel: string;
  season: string;
  // Cards are nights at one venue rather than venues.
  byNight?: boolean;
  // Athletes-per-team is a roster size, which only holds season-to-date. On a
  // week basis the two sides count different cohorts — athletes who joined a
  // team registered in an earlier week — so the ratio is left off.
  showAvgPerTeam?: boolean;
}) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-glass-text-tertiary mb-2">
        {byNight ? "By night" : "By location"}
      </h3>
      {/* One grid across the whole strip rather than a row of independent
          cards, so every section starts on the same line at every venue: a
          card with no retention lines leaves the gap rather than pulling Age
          and Revenue up to a different height from its neighbours. Each card
          is a subgrid spanning all nine rows, so the row heights are shared.
          The count has to match the card's direct children: add a section and
          this number moves with it, or the last one spills into an implicit
          row and lands beside its neighbour instead of under it.
          Where subgrid is missing the cards simply fall back to sizing their
          own rows — the old, unaligned behaviour, not a broken one. */}
      <div className="grid grid-flow-col auto-cols-[300px] gap-x-3 overflow-x-auto pb-2 snap-x"
        style={{ gridTemplateRows: "repeat(9, auto)" }}>
        {locations.map((l) => {
          const get = (kind: string, metric: PacingMetric) =>
            l.seasons.find((s) => s.kind === kind)?.[metric] ?? 0;
          const locCurrency = l.seasons.find((s) => s.kind === "current")?.currency ?? "CAD";
          // What a season's revenue works out to per athlete registered in it,
          // team fees left out (see PacingSeason.athletes_indiv). Rounded to
          // the dollar; cents are noise against a season total.
          const perAthlete = (kind: string) => {
            const x = l.seasons.find((y) => y.kind === kind);
            if (!x) return 0;
            const indiv = x.athletes_indiv != null;
            const a = indiv ? x.athletes_indiv! : x.athletes;
            const rev = (indiv ? x.revenue_indiv_native : x.revenue_native) ?? 0;
            return a ? Math.round(rev / a) : 0;
          };
          const curTeams = get("current", "captains");
          const avgPerTeam = curTeams ? get("current", "athletes") / curTeams : null;
          const avgColor = rosterColor(avgPerTeam);
          return (
            <div key={l.location}
              className="snap-start grid row-span-full rounded-xl border border-glass-border bg-glass-surface"
              style={{ gridTemplateRows: "subgrid" }}>
              <div className="flex items-baseline justify-between gap-2 px-3.5 pt-3.5">
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2.5 px-3.5">
                <LocationMetric label="Teams"
                  cur={get("current", "captains")} prev={get("prev_season", "captains")} year={get("prev_year", "captains")}
                  prevLabel={prevLabel} yearLabel={yearLabel}
                  notes={[
                    { text: `${get("current", "full_roster").toLocaleString()} with 7 or more players` },
                    ...(get("current", "low_roster")
                      ? [{ text: `${get("current", "low_roster").toLocaleString()} with 3 or fewer players`, tone: "bad" as const }]
                      : []),
                  ]} />
                <LocationMetric label="Athletes"
                  cur={get("current", "athletes")} prev={get("prev_season", "athletes")} year={get("prev_year", "athletes")}
                  prevLabel={prevLabel} yearLabel={yearLabel} />
              </div>
              {/* Where the teams actually sit. A division whose teams are all
                  at 7+ reads green, so the one that is not filling stands out
                  without comparing two numbers in your head. */}
              {!!l.divisions?.length && (
                <div className="px-3.5 mt-2.5 pt-2.5 border-t border-glass-border-light">
                  {/* Column headings, so the two numbers say what they are
                      rather than leaving the reader to infer them. */}
                  <div className="flex items-baseline gap-2 text-[10px] font-semibold uppercase tracking-wider text-glass-text-tertiary mb-1">
                    <span className="flex-1 min-w-0">Divisions</span>
                    <span className="shrink-0">Teams</span>
                    <span className="shrink-0 w-16 text-right">With 7+</span>
                  </div>
                  {l.divisions.map((d) => (
                    <div key={d.name} className="flex items-baseline gap-2 text-[11px] leading-snug">
                      <span className="truncate flex-1 min-w-0 text-glass-text-secondary" title={d.name}>{d.name}</span>
                      <span className="tabular font-semibold shrink-0" style={{ color: "var(--glass-text)" }}>{d.teams}</span>
                      <span className="tabular text-[10px] shrink-0 w-16 text-right"
                        style={{ color: d.full_roster === d.teams ? "rgb(74,222,128)" : "var(--glass-text-tertiary)" }}>
                        {d.full_roster}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className="px-3.5">{(() => {
                const pick = (k: string, m: "returning_captains_pct" | "returning_athletes_pct") =>
                  l.seasons.find((s) => s.kind === k)?.[m] ?? null;
                const curSeason = l.seasons.find((s) => s.kind === "current");
                const lines = ([
                  ["captains", "returning_captains_pct", "returning_captains", "returning_captains_of"],
                  ["athletes", "returning_athletes_pct", "returning_athletes", "returning_athletes_of"],
                ] as const).map(([noun, m, nKey, ofKey]) => ({
                  noun,
                  n: curSeason?.[nKey] ?? null,
                  of: curSeason?.[ofKey] ?? null,
                  cur: pick("current", m),
                  prev: pick("prev_season", m),
                  year: pick("prev_year", m),
                })).filter((x) => x.cur != null);
                if (!lines.length) return null;
                return (
                  <div className="mt-2.5 pt-2.5 border-t border-glass-border-light text-[11px] leading-snug">
                    <p className="text-[11px] sm:text-[10px] font-semibold uppercase tracking-wider text-glass-text-tertiary mb-0.5">
                      Played Brodie before
                    </p>
                    {lines.map((x) => (
                      <span key={x.noun} className="block">
                        <span className="font-semibold" style={{ color: "var(--glass-text-secondary)" }}>
                          {x.cur!.toFixed(1)}%
                        </span>
                        <span className="text-glass-text-tertiary"> of {x.noun}</span>
                        {x.n != null && x.of != null && (
                          <span className="text-glass-text-tertiary tabular"> · {x.n} of {x.of}</span>
                        )}
                        {([[x.prev, prevLabel], [x.year, yearLabel]] as const).map(([base, lbl]) =>
                          base == null ? null : (
                            <span key={lbl} className="text-[10px] sm:text-[9px] font-semibold"
                              style={{ color: upColor(x.cur! - base) }}>
                              {" "}({x.cur! - base > 0 ? "+" : ""}{(x.cur! - base).toFixed(1)} vs {lbl})
                            </span>
                          ))}
                      </span>
                    ))}
                  </div>
                );
              })()}</div>
              {/* Both lines ask the same question — what share of the prior
                  season's athletes came back — the second one a year earlier,
                  so the two can actually be compared. Each names the season
                  people came FROM. The current line carries the movement
                  between them, in points: the difference of two percentages is
                  points, not a percentage of a percentage. */}
              <div className="px-3.5">{(l.retention || l.retention_year) && (
                <div className="mt-3 text-[11px] leading-snug">
                  {[l.retention, l.retention_year].filter(Boolean).map((r, i) => {
                    const into = shortSeason(r!.into_season ?? season);
                    const pts = i === 0 && l.retention && l.retention_year
                      ? Math.round((l.retention.pct - l.retention_year.pct) * 10) / 10
                      : null;
                    return (
                      <span key={r!.prev_season} className="block whitespace-nowrap"
                        title={`${r!.retained} of ${r!.prev_athletes} ${shortSeason(r!.prev_season)} athletes registered again in ${into}`}>
                        <span className="font-semibold" style={{ color: "var(--glass-text-secondary)" }}>
                          {r!.pct.toFixed(1)}%
                        </span>
                        <span className="text-glass-text-tertiary">
                          {" "}of {shortSeason(r!.prev_season)} returned in {into}
                        </span>
                        <span className="text-glass-text-tertiary tabular"> · {r!.retained} of {r!.prev_athletes}</span>
                        {pts != null && (
                          <span className="text-[10px] sm:text-[9px] font-semibold" style={{ color: upColor(pts) }}>
                            {" "}({pts > 0 ? "+" : ""}{pts.toFixed(1)} pts)
                          </span>
                        )}
                      </span>
                    );
                  })}
                </div>
              )}</div>
              <div className="px-3.5">{(() => {
                const at = (k: string) => l.seasons.find((s) => s.kind === k)?.age ?? null;
                const cur = at("current");
                return cur ? <LocationAge age={cur} prev={at("prev_season")} year={at("prev_year")}
                  prevLabel={prevLabel} yearLabel={yearLabel}
                  athletes={l.seasons.find((s) => s.kind === "current")?.athletes ?? null} /> : null;
              })()}</div>
              {/* Below retention, and in the currency the venue actually
                  invoices in — a US venue's own card should not restate its
                  revenue as Canadian dollars. */}
              {/* Revenue beside what it works out to per athlete — the two
                  move independently: a venue can hold its revenue up on fewer,
                  better-paying players, or lose it on cheaper ones. */}
              <div className="mt-2.5 pt-2.5 border-t border-glass-border-light grid grid-cols-1 sm:grid-cols-2 gap-3 px-3.5">
                <LocationMetric label={`Revenue (${locCurrency})`} money
                  cur={get("current", "revenue_native")} prev={get("prev_season", "revenue_native")} year={get("prev_year", "revenue_native")}
                  prevLabel={prevLabel} yearLabel={yearLabel} />
                <LocationMetric label={`Per athlete (${locCurrency})`} money
                  cur={perAthlete("current")} prev={perAthlete("prev_season")} year={perAthlete("prev_year")}
                  prevLabel={prevLabel} yearLabel={yearLabel} />
              </div>
              {/* What came off the price to get there. Always rendered, even
                  empty, so it holds its row in the shared grid. */}
              <div className="px-3.5">{(() => {
                const d = discounts ? discountFor(l.location, discounts, byNight) : undefined;
                return d && d.regs > 0
                  ? <LocationDiscounts row={d} season={season} seasonToDate={discountsSeasonToDate} />
                  : null;
              })()}</div>
              {/* Its own row, so it is not competing with the retention lines
                  for the same baseline. Opens this venue's list of discounted
                  players — a night card's venue, since that list has no night
                  cut. */}
              <div className="mt-2 flex justify-end px-3.5 pb-3.5">
                <a href={`/discounts/players?${new URLSearchParams({ season, location: byNight ? (venue ?? l.location) : l.location })}`}
                  className="text-[11px] font-semibold hover:brightness-110 transition" style={{ color: "var(--glass-gold)" }}>
                  View discounts →
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
  // The dashboard route hosts both views and names them in tabs, so it keeps
  // its own heading across the pair. The standalone /weekly-review route is
  // still its own page with its own title.
  showViewTabs = false,
}: {
  searchParams: Promise<{ season?: string; location?: string; lm?: string; week?: string; regBasis?: string;
    overdueSeason?: string; regsSeason?: string; promoSeason?: string; bookingSeason?: string;
    tab?: string;
    }>;
  mode?: "full" | "registrations" | "weekly";
  showViewTabs?: boolean;
}) {
  await requireUser();
  const isReg = mode === "registrations";
  const isWeekly = mode === "weekly";
  const { season: seasonParam, location: locationParam, week: weekParam, regBasis,
    overdueSeason, regsSeason, promoSeason, bookingSeason, tab: tabParam } = await searchParams;
  // The Registrations page's second tab: who came back, rather than how many.
  const isRetention = isReg && tabParam === "retention";
  // Its third: of last season's players (and the last four seasons'), how
  // many are back.
  const isBack = isReg && tabParam === "back";
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
  // Registration work runs a season ahead of the games, so Registrations, the
  // Promo Tracker and Facility Bookings default to the season being sold and
  // can be read back on the one being played. On the Registrations tab the
  // filter already picks the season outright, so there is nothing to toggle.
  const prepSeason = (p?: string) => (p === "current" ? selectedSeason : regSeason);
  const seasonToggle = (param: string, p?: string) =>
    !isReg && regSeason !== selectedSeason ? (
      <BasisToggle
        param={param}
        value={p === "current" ? "current" : "next"}
        defaultValue="next"
        options={[{ value: "current", label: selectedSeason }, { value: "next", label: regSeason }]}
      />
    ) : undefined;
  const promoSeasonName = isReg ? selectedSeason : prepSeason(promoSeason);
  const bookingSeasonName = isReg ? selectedSeason : prepSeason(bookingSeason);
  const pacingSeason = isReg ? selectedSeason : prepSeason(regsSeason);

  // Live, season + location/LM scoped section cards (fall back to sample if unwired).
  const scope: Scope = { locationNames };
  // Sections whose source app aggregates over several seasons/weeks get the
  // whole selection; the rest use the primary one. Registration pacing keeps a
  // single week because its window is offset-aligned to each season's start,
  // so a union of calendar weeks has no meaning there.
  const seasonsParam = selectedSeasons.length ? selectedSeasons.join(",") : selectedSeason;
  const weeksParam = activeWeeks.length ? activeWeeks.join(",") : undefined;
  // Registrations mode shows only the Registrations section, so skip the other
  // source loads entirely — just fetch pacing.
  // Only what the page header and the top two sections need is awaited here.
  // Everything below streams in its own Suspense boundary, so the shell is not
  // held behind the slowest source app. promoTiles stays because two sections
  // share it and it should not be fetched twice.
  const [ckCurrent, ckNext, promoTiles, pacing, deadlines, locDiscounts] = await Promise.all([
    isReg ? Promise.resolve(null) : loadChecklistTiles(selectedSeason, scope, promoLocations),
    isReg ? Promise.resolve(null) : loadChecklistTiles(regSeason, scope, promoLocations),
    isReg ? Promise.resolve(null) : loadPromoTiles(promoSeasonName, scope),
    loadRegistrationPacing(pacingSeason, scope, regOnWeek ? week : undefined, isRetention, isBack),
    isReg ? Promise.resolve([] as DeadlineWeek[]) : loadDeadlines(),
    // Per night when the cards are nights (a single venue), else per venue.
    loadLocationDiscounts(pacingSeason, scope, scope.locationNames?.length === 1),
  ]);
  const pacingCurrent = pacing?.seasons.find((s) => s.kind === "current");
  const pacingPrevSeason = pacing?.seasons.find((s) => s.kind === "prev_season");
  const pacingPrevYear = pacing?.seasons.find((s) => s.kind === "prev_year");
  // A row of the Registrations section reads one population — every venue in
  // scope, or one country's — and its bars, deltas and roster notes all come
  // from that row's seasons.
  type RegSet = { cur: PacingSeason; prev?: PacingSeason; year?: PacingSeason; all: PacingSeason[] };
  const allSet: RegSet | null = pacing && pacingCurrent
    ? { cur: pacingCurrent, prev: pacingPrevSeason, year: pacingPrevYear, all: pacing.seasons }
    : null;
  // One country's teams, athletes and rosters laid over each season. Revenue
  // is already split by currency on every season, so it needs no projecting.
  const countrySet = (c: "CAN" | "USA"): RegSet | null => {
    if (!allSet?.cur.by_country) return null;
    const proj = (x: PacingSeason): PacingSeason => {
      if (!x.by_country) return x;
      const b = x.by_country[c];
      // Per player leaves team fees out, when the feed has the split.
      const indiv = b.athletes_indiv != null;
      const a = indiv ? b.athletes_indiv! : b.athletes;
      const rev = (c === "CAN"
        ? (indiv ? x.revenue_indiv_cad : x.revenue_cad)
        : (indiv ? x.revenue_indiv_usd : x.revenue_usd)) ?? 0;
      return { ...x, ...b, revenue_per_athlete: a ? Math.round(rev / a) : undefined };
    };
    return {
      cur: proj(allSet.cur),
      prev: allSet.prev && proj(allSet.prev),
      year: allSet.year && proj(allSet.year),
      all: allSet.all.map(proj),
    };
  };
  // Same-day difference: current season minus the comparison season at day N.
  const regDelta = (set: RegSet, metric: PacingMetric, against?: PacingSeason) =>
    against ? (set.cur[metric] ?? 0) - (against[metric] ?? 0) : null;
  const rosterDelta = (set: RegSet, against?: PacingSeason) =>
    set.cur.full_roster != null && against?.full_roster != null
      ? set.cur.full_roster - against.full_roster
      : null;
  // A column of the Registrations row: the bar card's metric, and — where the
  // headline is the wrong thing to compare — what its two delta cards read
  // instead.
  type RegMetric = {
    key: PacingMetric; format: "number" | "money" | "age";
    title: string; barTitle: string; barSub: string;
    notes?: { text: string; tone?: "bad" }[]; roster: boolean;
    // Retention lines under the bars. Only the two count cards have any.
    footer?: ShareGroup[];
    // Drawn in place of the season bars where a distribution says more.
    bands?: { label: string; n: number }[];
    // An age headline is never compared as years, so it always carries these;
    // the fallback at the call site only exists to say so to the compiler.
    deltaTitle?: string; deltaFormat?: "number" | "money" | "points";
    deltaOf?: (s?: PacingSeason | null) => number | null;
  };
  const metricBase = (m: RegMetric, against?: PacingSeason) =>
    m.deltaOf ? m.deltaOf(against) : (against?.[m.key] ?? null);
  const metricDelta = (set: RegSet, m: RegMetric, against?: PacingSeason) => {
    if (!m.deltaOf) return regDelta(set, m.key, against);
    const cur = m.deltaOf(set.cur), was = m.deltaOf(against);
    return cur != null && was != null ? Math.round((cur - was) * 10) / 10 : null;
  };
  // A scope of only Canadian venues has no USD to report, and vice versa. Drop
  // the empty currency's column rather than show a card of zeroes — but only
  // when it is empty in every season, so a venue that simply has not invoiced
  // yet this season keeps its comparison.
  const hasCurrency = (k: "revenue_cad" | "revenue_usd") =>
    (pacing?.seasons ?? []).some((s) => (s[k] ?? 0) !== 0);

  const regBars = (set: RegSet, metric: PacingMetric) =>
    set.all.map((s) => ({ label: s.season, sub: KIND_LABEL[s.kind] ?? s.kind, value: s[metric] ?? 0, color: REG_COLOR[s.kind] ?? "var(--glass-border-light)" }));
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
  // Only on Weekly review, where the two bases sit side by side and a section
  // has to say which one it is on. On Season review everything reads the season
  // and a badge on every heading would say nothing twelve times.
  const fullTag = isWeekly ? "Season" : "";
  const weekTag = isWeekly ? "Week" : "";

  // What the count card says about the people behind its number. Both shares
  // are measured at day N whatever the weekly toggle says — they are seasons
  // to date, and a week's worth of registrations is too few to read a share
  // off — so they carry no week wording.
  const shareGroups = (noun: "captains" | "athletes"): ShareGroup[] => {
    if (!pacingCurrent) return [];
    const k = noun === "captains" ? "returning_captains_pct" as const : "returning_athletes_pct" as const;
    const cur = pacingCurrent[k];
    const groups: ShareGroup[] = [];
    if (cur != null) {
      groups.push({
        label: "Played Brodie before",
        lines: [{
          pct: cur,
          text: `of ${noun}`,
          count: (() => {
            const n = pacingCurrent[noun === "captains" ? "returning_captains" : "returning_athletes"];
            const of = pacingCurrent[noun === "captains" ? "returning_captains_of" : "returning_athletes_of"];
            return n != null && of != null ? { n, of } : null;
          })(),
          deltas: ([pacingPrevSeason, pacingPrevYear] as const)
            .filter((s): s is PacingSeason => s?.[k] != null)
            .map((s) => ({ value: cur - s[k]!, label: `vs ${shortSeason(s.season)}` })),
        }],
      });
    }
    // How many of last season's came back, each card on its own population:
    // a team does not return, its captain does, and only as a captain — one
    // who comes back as another team's player brought no team with them. The
    // two lines name their population, since the same sentence with a
    // different number sits on the card next to it.
    const cur1 = noun === "captains" ? pacing?.retention_captains : pacing?.retention;
    const yr1 = noun === "captains" ? pacing?.retention_captains_year : pacing?.retention_year;
    const pair = [cur1, yr1].filter((r): r is Retention => !!r);
    if (pair.length) {
      const pts = cur1 && yr1 ? Math.round((cur1.pct - yr1.pct) * 10) / 10 : null;
      groups.push({
        lines: pair.map((r, i) => ({
          pct: r.pct,
          text: `of ${shortSeason(r.prev_season)} ${noun} returned in ${shortSeason(r.into_season ?? pacingCurrent.season)}`,
          count: { n: r.retained, of: r.prev_athletes },
          title: `${r.retained} of ${r.prev_athletes} ${shortSeason(r.prev_season)} ${noun} registered again`,
          deltas: i === 0 && pts != null ? [{ value: pts, label: "pts" }] : [],
        })),
      });
    }
    return groups;
  };

  // "day 1" starts at the first minute of a season, so on opening day it reads
  // as a full day against a full day of last season's — the comparison is
  // eleven hours against eleven hours. Under a day, say the hours.
  const eh = pacing?.elapsed_hours ?? null;
  const regWindow = eh != null && eh < 24
    ? `${eh}h into registration`
    : `day ${pacing?.day_n ?? "?"} of registration`;
  const regWindowShort = eh != null && eh < 24 ? `${eh}h in` : `day ${pacing?.day_n ?? "?"}`;
  const regBarWhen = regOnWeek ? `week of ${weekLabel}` : regWindow;
  const regDeltaWhen = regOnWeek ? `week of ${weekLabel}` : regWindowShort;

  // A strip of location (or night) cards. Each country's sits under its own
  // row, so Canadian venues are read beside Canada's totals.
  const strip = (locs?: PacingLocation[]) => locs?.length && pacingCurrent ? (
    <div className="pt-1">
      <LocationStrip
        locations={locs}
        prevLabel={shortSeason(pacingPrevSeason?.season ?? "")}
        yearLabel={shortSeason(pacingPrevYear?.season ?? "")}
        season={pacingCurrent.season}
        showAvgPerTeam={!regOnWeek}
        byNight={locationNames?.length === 1}
        venue={locationNames?.length === 1 ? locationNames[0] : undefined}
        discounts={locDiscounts} discountsSeasonToDate={regOnWeek} />
    </div>
  ) : null;
  // The Registrations columns. Teams and athletes appear for the whole scope
  // and again per country; revenue only per country, as CAD and USD are
  // different money.
  type Place = { code: "CAN" | "USA"; name: string; title: string; revenue: "revenue_cad" | "revenue_usd"; heading: string };
  const teamsMetric = (set: RegSet, place?: Place): RegMetric => ({
    key: "captains", format: "number",
    title: place ? `${place.title} teams` : "Teams",
    barTitle: place ? `Total teams – ${place.name}` : "Total teams", barSub: regBarWhen,
    notes: [
      ...(set.cur.full_roster != null
        ? [{ text: `${set.cur.full_roster.toLocaleString()} with 7 or more players` }] : []),
      ...(set.cur.low_roster
        ? [{ text: `${set.cur.low_roster.toLocaleString()} with 3 or fewer players`, tone: "bad" as const }] : []),
    ],
    roster: true,
    // Played-before and retention are measured on the whole scope only.
    footer: place ? undefined : shareGroups("captains"),
  });
  const athletesMetric = (set: RegSet, place?: Place): RegMetric => ({
    key: "athletes", format: "number",
    title: place ? `${place.title} athletes` : "Athletes",
    barTitle: place ? `Total athletes – ${place.name}` : "Total athletes", barSub: regBarWhen,
    // The roster size the season is actually running at.
    notes: set.cur.captains ? [{ text: `${(set.cur.athletes / set.cur.captains).toFixed(2)} per team` }] : undefined,
    roster: false,
    footer: place ? undefined : shareGroups("athletes"),
  });
  // Accrued, in the currency the venues invoice in. CAD and USD stay apart:
  // a fixed conversion rate would bury a real change in either.
  const revenueMetric = (k: "revenue_cad" | "revenue_usd"): RegMetric => ({
    key: k, format: "money",
    title: k === "revenue_cad" ? "CAD rev" : "USD rev",
    barTitle: k === "revenue_cad" ? "Revenue (CAD)" : "Revenue (USD)",
    barSub: `accrued · ${regBarWhen}`,
    notes: undefined, roster: false,
  });
  // What a country's revenue works out to per athlete registered. Compared
  // through deltaOf so a season with no athletes reads "—" rather than as a
  // jump from zero.
  const perPlayerMetric = (place: Place): RegMetric => {
    const cur = place.revenue === "revenue_cad" ? "CAD" : "USD";
    return {
      key: "revenue_per_athlete", format: "money",
      title: `${cur} per player`, barTitle: `Revenue per player (${cur})`,
      barSub: `accrued · ${regBarWhen}`,
      // Said on the card: the revenue card beside it does include them.
      notes: [{ text: "team fees left out" }], roster: false,
      deltaFormat: "money",
      deltaOf: (x?: PacingSeason | null) => x?.revenue_per_athlete ?? null,
    };
  };
  // Only where the season has birth dates to average. The chip carries the
  // share it is averaging over: roughly one athlete in ten has no birth date
  // on file, and an average age is a different claim read off half a season
  // than off all of it.
  const ageMetric: RegMetric | null = pacingCurrent?.age_median != null ? {
    key: "age_median", format: "age",
    title: "Age", barTitle: "Median age",
    barSub: `at season start · ${regBarWhen}`,
    notes: pacingCurrent.age?.coverage_pct != null
      ? [{ text: `${pacingCurrent.age.coverage_pct}% have a birth date · ${pacingCurrent.age.n.toLocaleString()} of ${pacingCurrent.athletes.toLocaleString()}` }]
      : undefined,
    roster: false,
    bands: pacingCurrent.age?.bands,
    // The median is the right headline and the wrong thing to compare: whole
    // years, so it jumps one either way on a fractional shift across the
    // midpoint and sits still through everything else. The comparisons track
    // the share under 24, which moves when the intake moves.
    deltaTitle: "Under 24", deltaFormat: "points",
    deltaOf: (x?: PacingSeason | null) => x?.age?.under_24_pct ?? null,
  } : null;
  const PLACES: Place[] = [
    { code: "CAN", name: "Canada", title: "Canada", revenue: "revenue_cad", heading: "Canada" },
    { code: "USA", name: "USA", title: "US", revenue: "revenue_usd", heading: "United States" },
  ];
  const placeSets = PLACES.map((p) => ({ place: p, set: countrySet(p.code) }));
  // The location cards, filed under their country's row. Any the feed could
  // not place (an older feed, a failed lookup) keep one strip of their own.
  const locsByCountry = new Map<string, PacingLocation[]>();
  for (const l of pacing?.locations ?? []) {
    const k = l.country === "CAN" || l.country === "USA" ? l.country : "other";
    if (!locsByCountry.has(k)) locsByCountry.set(k, []);
    locsByCountry.get(k)!.push(l);
  }
  // ---- Retention tab ----------------------------------------------------
  const keptFor = (x: PacingSeason | undefined, where: "all" | "CAN" | "USA") =>
    !x ? undefined : where === "all" ? x.kept : x.kept_by_country?.[where];
  // One retention measure as a column: its share in each season, then the
  // same-day change against the previous season and the previous year.
  const keptColumn = (where: "all" | "CAN" | "USA", pop: "cap" | "ath", w: KeptWindow) => {
    const v = (x?: PacingSeason) => keptPct(keptFor(x, where), pop, w);
    const cur = keptFor(pacingCurrent, where);
    const curV = v(pacingCurrent);
    const noun = pop === "cap" ? "captains" : "athletes";
    const Noun = pop === "cap" ? "Captains" : "Athletes";
    const brodie = w === "ever" || w === "never";
    const span = w === "ever" ? "played Brodie before" : w === "never" ? "never played before"
      : w.endsWith("prev") ? "last season" : "last 4 seasons";
    const title = brodie ? `${Noun} · ${span}` : `Returning ${noun} · ${span}`;
    const sub = w === "ever" ? "in any earlier season, at any location"
      : w === "never" ? "their first Brodie season"
      : `${w.startsWith("same") ? "played at this location" : "played anywhere in Brodie"} ${w.endsWith("prev") ? "the season before" : "in one of the 4 seasons before"}`;
    const change = (against?: PacingSeason) => {
      const was = v(against);
      return curV != null && was != null ? Math.round((curV - was) * 10) / 10 : null;
    };
    const dTitle = brodie ? `${Noun} ${w === "ever" ? "played before" : "never played"}` : `${Noun} ${span}`;
    // More newcomers is neither good nor bad on its own, so that change stays
    // neutral; everything else is better up.
    const scored = w !== "never";
    const n = cur ? keptCount(cur, pop, w) : null;
    return (
      <div key={`${where}-${pop}-${w}`} className="h-full flex flex-col gap-4">
        <div className="flex-1">
          <RegBarCard title={title}
            subtitle={`${sub} · ${regBarWhen}`}
            format="percent" current={curV ?? 0}
            bars={(pacing?.seasons ?? []).map((x) => ({
              label: x.season, sub: KIND_LABEL[x.kind] ?? x.kind, value: v(x) ?? 0,
              color: REG_COLOR[x.kind] ?? "var(--glass-border-light)",
            }))}
            notes={cur && n != null ? [{ text: `${n.toLocaleString()} of ${cur[`${pop}_total`].toLocaleString()} ${noun}` }] : undefined} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <RegDeltaCard title={`${dTitle} vs prev season`} format="points" scored={scored}
            subtitle={`${shortSeason(pacingCurrent?.season ?? "")} vs ${pacingPrevSeason ? shortSeason(pacingPrevSeason.season) : "—"} · ${regDeltaWhen}`}
            delta={change(pacingPrevSeason)} base={v(pacingPrevSeason)} />
          <RegDeltaCard title={`${dTitle} vs prev year`} format="points" scored={scored}
            subtitle={`${shortSeason(pacingCurrent?.season ?? "")} vs ${pacingPrevYear ? shortSeason(pacingPrevYear.season) : "—"} · ${regDeltaWhen}`}
            delta={change(pacingPrevYear)} base={v(pacingPrevYear)} />
        </div>
      </div>
    );
  };
  // Two rows per scope: retained at the same venue, then anywhere in Brodie.
  // Brodie overall only once the feed carries "ever".
  const hasEver = pacingCurrent?.kept?.ath_ever != null;
  const keptRows = (where: "all" | "CAN" | "USA") => ([
    ...(hasEver ? ["brodie" as const] : []), "same" as const, "any" as const,
  ]).map((mode) => (
    <div key={`${where}-${mode}`} className="space-y-2">
      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-glass-text-tertiary">
        {mode === "brodie" ? "Brodie overall" : mode === "same" ? "Same location" : "Any Brodie location"}
        <span className="normal-case tracking-normal font-normal">
          {" "}— {mode === "brodie"
            ? "played Brodie in any earlier season, at any location, or never"
            : mode === "same"
            ? "counts a player only if they played at this location before"
            : "counts a player who played at any Brodie location before"}
        </span>
      </h4>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {(mode === "brodie"
          ? ([["cap", "ever"], ["cap", "never"], ["ath", "ever"], ["ath", "never"]] as const)
          : ([["cap", `${mode}_prev`], ["cap", `${mode}_4`], ["ath", `${mode}_prev`], ["ath", `${mode}_4`]] as const))
          .map(([pop, w]) => keptColumn(where, pop, w as KeptWindow))}
      </div>
    </div>
  ));
  const keptHas = (c: "CAN" | "USA") => (pacing?.seasons ?? []).some((x) => (keptFor(x, c)?.ath_total ?? 0) > 0);
  // In a one-country scope that country's rows would repeat the top ones, so
  // it keeps only its location cards.
  const keptSpansBoth = keptHas("CAN") && keptHas("USA");
  const keptNOf = (k: Kept | undefined, pop: "cap" | "ath", w: KeptWindow) => {
    const n = k ? keptCount(k, pop, w) : null;
    return k && n != null ? { n, of: k[`${pop}_total`] } : null;
  };
  const keptBlocks: ShareBlock[] = [
    ...(hasEver ? [{ label: "Brodie overall", rows: [
      { label: "Played before", get: (x?: PacingSeason, pop?: "cap" | "ath") => keptNOf(x?.kept, pop!, "ever") },
      // Newcomers have no good direction; their changes stay neutral.
      { label: "Never played", neutral: true, get: (x?: PacingSeason, pop?: "cap" | "ath") => keptNOf(x?.kept, pop!, "never") },
    ] }] : []),
    { label: "This location", rows: [
      { label: "Last season", get: (x?: PacingSeason, pop?: "cap" | "ath") => keptNOf(x?.kept, pop!, "same_prev") },
      { label: "Last 4 seasons", get: (x?: PacingSeason, pop?: "cap" | "ath") => keptNOf(x?.kept, pop!, "same_4") },
    ] },
    { label: "Any Brodie location", rows: [
      { label: "Last season", get: (x?: PacingSeason, pop?: "cap" | "ath") => keptNOf(x?.kept, pop!, "any_prev") },
      { label: "Last 4 seasons", get: (x?: PacingSeason, pop?: "cap" | "ath") => keptNOf(x?.kept, pop!, "any_4") },
    ] },
  ];
  const keptStrip = (locs?: PacingLocation[]) => locs?.length ? (
    <div className="pt-1">
      <ShareStrip locations={locs} byNight={locationNames?.length === 1} blocks={keptBlocks}
        head={(x) => x?.kept ? `${x.kept.cap_total.toLocaleString()} captains · ${x.kept.ath_total.toLocaleString()} athletes` : ""}
        prevLabel={shortSeason(pacingPrevSeason?.season ?? "")} yearLabel={shortSeason(pacingPrevYear?.season ?? "")} />
    </div>
  ) : null;

  // ---- Retention: past players ---------------------------------------------
  const backFor = (x: PacingSeason | undefined, where: "all" | "CAN" | "USA") =>
    !x ? undefined : where === "all" ? x.back : x.back_by_country?.[where];
  // "prev" is last season's players; "yr" the same term a year back.
  type BackWin = "prev" | "yr";
  const backNOf = (b: Back | undefined, pop: "cap" | "ath", win: BackWin, mode: "here" | "any") => {
    const n = b?.[`${pop}_${win}_${mode}`], of = b?.[`${pop}_${win}_n`];
    return n != null && of != null ? { n, of } : null;
  };
  const backPct = (b: Back | undefined, pop: "cap" | "ath", win: BackWin, mode: "here" | "any") => {
    const x = backNOf(b, pop, win, mode);
    return x && x.of ? Math.round((1000 * x.n) / x.of) / 10 : null;
  };
  const backColumn = (where: "all" | "CAN" | "USA", pop: "cap" | "ath", win: BackWin, mode: "here" | "any") => {
    const v = (x?: PacingSeason) => backPct(backFor(x, where), pop, win, mode);
    const cur = backFor(pacingCurrent, where);
    const curV = v(pacingCurrent);
    const noun = pop === "cap" ? "captains" : "athletes";
    // A year back is the same term: each season's bar reads its own (Winter
    // '27 against Winter '26's players, Fall '26 against Fall '25's).
    const title = win === "prev" ? `Last season's ${noun} back` : `Last year's ${noun} back`;
    const sub = pop === "cap"
      ? (mode === "here" ? "captaining again where they played" : "captaining again anywhere in Brodie")
      : (mode === "here" ? "registered again where they played" : "registered again anywhere in Brodie");
    const change = (against?: PacingSeason) => {
      const was = v(against);
      return curV != null && was != null ? Math.round((curV - was) * 10) / 10 : null;
    };
    const dTitle = win === "prev" ? `Last season's ${noun}` : `Last year's ${noun}`;
    const chip = cur ? backNOf(cur, pop, win, mode) : null;
    return (
      <div key={`${where}-${pop}-${win}-${mode}`} className="h-full flex flex-col gap-4">
        <div className="flex-1">
          <RegBarCard title={title} subtitle={`${sub} · ${regBarWhen}`} format="percent" current={curV ?? 0}
            bars={(pacing?.seasons ?? []).map((x) => ({
              label: x.season, sub: KIND_LABEL[x.kind] ?? x.kind, value: v(x) ?? 0,
              color: REG_COLOR[x.kind] ?? "var(--glass-border-light)",
            }))}
            notes={chip ? [{ text: `${chip.n.toLocaleString()} of ${chip.of.toLocaleString()} ${noun}` }] : undefined} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <RegDeltaCard title={`${dTitle} vs prev season`} format="points" scored
            subtitle={`${shortSeason(pacingCurrent?.season ?? "")} vs ${pacingPrevSeason ? shortSeason(pacingPrevSeason.season) : "—"} · ${regDeltaWhen}`}
            delta={change(pacingPrevSeason)} base={v(pacingPrevSeason)} />
          <RegDeltaCard title={`${dTitle} vs prev year`} format="points" scored
            subtitle={`${shortSeason(pacingCurrent?.season ?? "")} vs ${pacingPrevYear ? shortSeason(pacingPrevYear.season) : "—"} · ${regDeltaWhen}`}
            delta={change(pacingPrevYear)} base={v(pacingPrevYear)} />
        </div>
      </div>
    );
  };
  const backRows = (where: "all" | "CAN" | "USA") => (["here", "any"] as const).map((mode) => (
    <div key={`${where}-${mode}`} className="space-y-2">
      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-glass-text-tertiary">
        {mode === "here" ? "Same location" : "Any Brodie location"}
        <span className="normal-case tracking-normal font-normal">
          {" "}— {mode === "here"
            ? "counts a player only if they came back to a location they played at"
            : "counts a player who came back to any Brodie location"}
        </span>
      </h4>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {([["cap", "prev"], ["cap", "yr"], ["ath", "prev"], ["ath", "yr"]] as const)
          .map(([pop, win]) => backColumn(where, pop, win, mode))}
      </div>
    </div>
  ));
  const backHas = (c: "CAN" | "USA") => (pacing?.seasons ?? []).some((x) => (backFor(x, c)?.ath_prev_n ?? 0) > 0 || (backFor(x, c)?.ath_yr_n ?? 0) > 0);
  const backSpansBoth = backHas("CAN") && backHas("USA");
  const backBlocks: ShareBlock[] = (["here", "any"] as const).map((mode) => ({
    label: mode === "here" ? "Back at this location" : "Back anywhere in Brodie",
    rows: (["prev", "yr"] as const).map((win) => ({
      label: win === "prev" ? "Last season's" : "Last year's",
      get: (x?: PacingSeason, pop?: "cap" | "ath") => backNOf(x?.back, pop!, win, mode),
    })),
  }));
  // Venue cards only: the cohort played an earlier season, so there is no
  // night of this one to file a returning player under.
  const backStrip = (locs?: PacingLocation[]) => locs?.length && locationNames?.length !== 1 ? (
    <div className="pt-1">
      <ShareStrip locations={locs} blocks={backBlocks}
        head={(x) => x?.back ? `of ${x.back.cap_prev_n.toLocaleString()} captains · ${x.back.ath_prev_n.toLocaleString()} athletes last season` : ""}
        prevLabel={shortSeason(pacingPrevSeason?.season ?? "")} yearLabel={shortSeason(pacingPrevYear?.season ?? "")} />
    </div>
  ) : null;
  const backView = () => (
    <section className="space-y-3">
      <div className="flex items-center gap-2.5">
        <h2 className="text-lg font-semibold" style={{ color: "var(--glass-text)" }}>Retention: past players</h2>
        {seasonToggle("regsSeason", regsSeason) ?? (
          <span className="text-[10px] sm:text-[9px] uppercase tracking-[0.16em] font-bold px-1.5 py-0.5 rounded"
            style={{ background: "var(--glass-gold-light, rgba(255,184,0,0.16))", color: "var(--glass-gold)" }}>{pacingSeason}</span>
        )}
      </div>
      {!pacingCurrent?.back ? (
        <div className="rounded-xl border border-glass-border bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary">
          Not connected. League Health couldn&apos;t load retention from the Promo Tracker, so no numbers are shown here.
        </div>
      ) : (
        <div className="space-y-8">
          <div className="space-y-5">{backRows("all")}</div>
          {PLACES.filter((p) => backHas(p.code) || (locsByCountry.get(p.code)?.length ?? 0) > 0).map((p) => (
            <div key={p.code} className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-glass-text-tertiary">{p.heading}</h3>
              {backSpansBoth && <div className="space-y-5">{backRows(p.code)}</div>}
              {backStrip(locsByCountry.get(p.code))}
            </div>
          ))}
          {backStrip(locsByCountry.get("other"))}
        </div>
      )}
    </section>
  );
  const retentionView = () => (
    <section className="space-y-3">
      <div className="flex items-center gap-2.5">
        <h2 className="text-lg font-semibold" style={{ color: "var(--glass-text)" }}>Retention</h2>
        {seasonToggle("regsSeason", regsSeason) ?? (
          <span className="text-[10px] sm:text-[9px] uppercase tracking-[0.16em] font-bold px-1.5 py-0.5 rounded"
            style={{ background: "var(--glass-gold-light, rgba(255,184,0,0.16))", color: "var(--glass-gold)" }}>{pacingSeason}</span>
        )}
      </div>
      {!pacingCurrent?.kept ? (
        // Never a guess: without the feed's retention there is nothing to show.
        <div className="rounded-xl border border-glass-border bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary">
          Not connected. League Health couldn&apos;t load retention from the Promo Tracker, so no numbers are shown here.
        </div>
      ) : (
        <div className="space-y-8">
          <div className="space-y-5">{keptRows("all")}</div>
          {PLACES.filter((p) => keptHas(p.code) || (locsByCountry.get(p.code)?.length ?? 0) > 0).map((p) => (
            <div key={p.code} className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-glass-text-tertiary">{p.heading}</h3>
              {keptSpansBoth && <div className="space-y-5">{keptRows(p.code)}</div>}
              {keptStrip(locsByCountry.get(p.code))}
            </div>
          ))}
          {keptStrip(locsByCountry.get("other"))}
        </div>
      )}
    </section>
  );
  const hasPeople = (set: RegSet | null) => !!set && set.all.some((x) => x.captains || x.athletes);
  // In a one-country scope that country's teams and athletes are the top row
  // again, so its row keeps only its revenue.
  const spansBoth = placeSets.filter((p) => hasPeople(p.set)).length > 1;
  const regRows: { key: string; heading: string | null; items: { m: RegMetric; set: RegSet }[] }[] = !allSet ? [] : [
    {
      key: "all", heading: null,
      items: [teamsMetric(allSet), athletesMetric(allSet), ...(ageMetric ? [ageMetric] : [])].map((m) => ({ m, set: allSet })),
    },
    ...placeSets.map(({ place, set }) => ({
      key: place.code, heading: place.heading,
      items: [
        ...(spansBoth && set && hasPeople(set)
          ? [{ m: teamsMetric(set, place), set }, { m: athletesMetric(set, place), set }] : []),
        // A scope with no venue in this currency has nothing to report; one
        // that simply has not invoiced yet this season keeps its comparison.
        ...(hasCurrency(place.revenue) ? [{ m: revenueMetric(place.revenue), set: set ?? allSet }] : []),
        // Needs the country's own athlete count, so only with the split.
        ...(hasCurrency(place.revenue) && set ? [{ m: perPlayerMetric(place), set }] : []),
      ],
    })),
  ].filter((r) => r.items.length > 0 || (locsByCountry.get(r.key)?.length ?? 0) > 0);

  return (
    <main className="brodie-fade-in space-y-8">
      <header>
        <p className="font-mono text-xs uppercase tracking-[0.18em] mb-1" style={{ color: "var(--glass-gold)" }}>
          {isReg ? "Registrations" : isWeekly && !showViewTabs ? "Weekly review" : "Dashboard"}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight" style={{ color: "var(--glass-text)" }}>
          {isReg ? "Registration pacing" : isWeekly && !showViewTabs ? "Weekly review" : "League overview"}
        </h1>
        <p className="text-sm mt-1 text-glass-text-secondary">
          {isBack
            ? <>Of the captains &amp; athletes who played the season before — and the same season a year before — how many have registered again by day N for {scopeLabel}, at the same location and anywhere in Brodie, vs the previous season and the previous year.</>
            : isRetention
            ? <>Of the captains &amp; athletes registered at day N for {scopeLabel}, how many played before — at the same location, and anywhere in Brodie — vs the previous season and the previous year.</>
            : isReg
            ? <>Teams &amp; athletes at day N of registration for {scopeLabel}, vs the previous season and the previous year.</>
            : isWeekly
              ? <>Cross-app health for {scopeLabel}, scoped to the week of {weekLabel} (Sat–Fri). Registrations, Stats Health &amp; Content Health are week-scoped; other sections show the season to date.</>
              : <>Cross-app health for {scopeLabel}.{snapDate ? ` As of ${snapDate}.` : ""}</>}
        </p>
        {/* The same control the sections use for their own either/or, so the
            page reads as one dashboard with two views rather than two pages. */}
        {showViewTabs && (
          <div className="mt-3">
            <BasisToggle
              param="view"
              value={isWeekly ? "weekly" : "season"}
              options={[{ value: "season", label: "Season review" }, { value: "weekly", label: "Weekly review" }]}
            />
          </div>
        )}
      </header>

      <Filters
        key={`${selectedSeasons.join(",")}|${activeWeeks.join(",")}|${selectedLocations.join(",")}`}
        options={options}
        current={{
          seasons: selectedSeasons.length ? selectedSeasons : [selectedSeason],
          locations: selectedLocations,
          ...(isWeekly ? { weeks: activeWeeks } : {}),
        }}
        keep={isRetention ? { tab: "retention" } : isBack ? { tab: "back" } : undefined}
      />
      {isReg && (
        <BasisToggle
          param="tab"
          value={isBack ? "back" : isRetention ? "retention" : "registrations"}
          options={[
            { value: "registrations", label: "Registrations" },
            // Of who registered, who played before.
            { value: "retention", label: "Retention: registered" },
            // Of who played before, who registered.
            { value: "back", label: "Retention: past players" },
          ]}
        />
      )}

      <div className="space-y-8">
        {!isReg && deadlines.length > 0 && <DeadlineBanner weeks={deadlines} />}
        {!isReg && (
          <Section title="Season Success Checklist" scopeTag={fullTag} href={`${APP_URL.checklist}/checklists?kind=lm`} tiles={checklistTiles} cols={6} />
        )}
        {isBack ? backView() : isRetention ? retentionView() : pacing && pacingCurrent ? (
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <h2 className="text-lg font-semibold" style={{ color: "var(--glass-text)" }}>Registrations</h2>
                {/* The toggle names the season itself, so the chip only shows
                    where there is nothing to switch between. */}
                {seasonToggle("regsSeason", regsSeason) ?? (
                  <span className="text-[10px] sm:text-[9px] uppercase tracking-[0.16em] font-bold px-1.5 py-0.5 rounded"
                    style={{ background: "var(--glass-gold-light, rgba(255,184,0,0.16))", color: "var(--glass-gold)" }}>{pacingSeason}</span>
                )}
                {isWeekly && (
                  <BasisToggle
                    param="regBasis"
                    value={regOnWeek ? "week" : "season"}
                    options={[{ value: "season", label: "Season" }, { value: "week", label: "Week" }]}
                  />
                )}
              </div>
              {/* No More details here: the Registrations tab is the detail view
                  for this section, reached from the nav. */}
            </div>
            <div className="space-y-5">
              {regRows.map((row) => (
                <div key={row.key} className="space-y-2">
                  {row.heading && (
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-glass-text-tertiary">{row.heading}</h3>
                  )}
                  {/* Four columns on every row, so each metric sits under
                      the same one in the row above. */}
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                    {/* One column per metric: its season bars, then the two
                        same-day comparisons underneath. */}
                    {row.items.map(({ m, set }) => (
                      <div key={`${row.key}-${m.key}`} className="h-full flex flex-col gap-4">
                        <div className="flex-1">
                          <RegBarCard title={m.barTitle} subtitle={m.barSub} format={m.format}
                            current={set.cur[m.key] ?? 0} bars={regBars(set, m.key)} notes={m.notes}
                            bands={m.bands} footer={m.footer} />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <RegDeltaCard
                            title={`${m.deltaTitle ?? m.title} vs prev season`} format={m.deltaFormat ?? (m.format === "age" ? "points" : m.format)}
                            subtitle={`${shortSeason(set.cur.season)} vs ${set.prev ? shortSeason(set.prev.season) : "—"} · ${regDeltaWhen}`}
                            delta={metricDelta(set, m, set.prev)} base={metricBase(m, set.prev)}
                            rosterDelta={m.roster ? rosterDelta(set, set.prev) : undefined}
                            rosterBase={m.roster ? set.prev?.full_roster ?? null : undefined} />
                          <RegDeltaCard
                            title={`${m.deltaTitle ?? m.title} vs prev year`} format={m.deltaFormat ?? (m.format === "age" ? "points" : m.format)}
                            subtitle={`${shortSeason(set.cur.season)} vs ${set.year ? shortSeason(set.year.season) : "—"} · ${regDeltaWhen}`}
                            delta={metricDelta(set, m, set.year)} base={metricBase(m, set.year)}
                            rosterDelta={m.roster ? rosterDelta(set, set.year) : undefined}
                            rosterBase={m.roster ? set.year?.full_roster ?? null : undefined} />
                        </div>
                      </div>
                    ))}
                  </div>
                  {row.key !== "all" && strip(locsByCountry.get(row.key))}
                </div>
              ))}
            </div>
            {strip(locsByCountry.get("other"))}
            {/* Registrations only. On the Dashboard and Weekly Review this
                section is a summary, and a 26-row chart buries everything
                under it. */}
            {/* The chart compares venues, so it has nothing to say when the
                view is already down to one. */}
            {isReg && locationNames?.length !== 1 && pacing.locations?.length ? (
              <AthletesVsRevenueChart
                locations={pacing.locations}
                prevLabel={shortSeason(pacingPrevSeason?.season ?? "")}
                yearLabel={shortSeason(pacingPrevYear?.season ?? "")} />
            ) : null}
          </section>
        ) : (
          <Section title="Registrations" href={APP_URL.crm} tiles={realTiles("crm")} seasonTag={pacingSeason} />
        )}
        {!isReg && (
          <>
            <Section title="Team Confirmed Stories" scopeTag={fullTag} href={`${APP_URL.promo}/team-confirmed-stories`}
              tiles={promoTiles?.tiles ?? null}
              seasonTag={seasonToggle("promoSeason", promoSeason) ? undefined : promoSeasonName}
              headerExtra={seasonToggle("promoSeason", promoSeason)} />
            <Suspense fallback={<SectionSkeleton title="Outreach" cols={4} />}>
              <OutreachCards scope={scope} season={regSeason} fullTag={fullTag} />
            </Suspense>
            <Suspense fallback={<TableSkeleton title="Site Visits" />}>
              <SiteVisitCards scope={scope} weeks={weeksParam} weekTag={weekTag} />
            </Suspense>
            <Suspense fallback={<TableSkeleton title="Video Reviews" />}>
              <VideoReviewCards scope={scope} weeks={weeksParam} weekTag={weekTag} />
            </Suspense>
            <Suspense fallback={<SectionSkeleton title="LM Game Day Checklist" />}>
              <GameDayCards scope={scope} season={selectedSeason} weeks={activeWeeks}
                tag={isWeekly ? weekTag : fullTag} />
            </Suspense>
            <Suspense fallback={<SectionSkeleton title="Training" />}>
              <TrainingCards scope={scope} fullTag={fullTag} />
            </Suspense>
            <Suspense fallback={<SectionSkeleton title="Stats Health" />}>
              <StatsHealthCards season={seasonsParam} scope={scope} weeks={weeksParam} weekTag={weekTag} />
            </Suspense>
            <Suspense fallback={<SectionSkeleton title="Content Health" />}>
              <ContentHealthCards season={seasonsParam} scope={scope} weeks={weeksParam} weekTag={weekTag} />
            </Suspense>
            <Suspense fallback={<SectionSkeleton title="Feedback" />}>
              <FeedbackCards season={selectedSeason} scope={scope} fullTag={fullTag} />
            </Suspense>
            <Suspense fallback={<SectionSkeleton title="Overdue Payments" />}>
              <OverdueCards season={selectedSeason} scope={scope} fullTag={fullTag} weekly={isWeekly}
                nextSeason={regSeason} onNext={overdueSeason === "next"} />
            </Suspense>
            <Suspense fallback={<TableSkeleton title="Facility Bookings" rows={6} />}>
              <BookingCards season={bookingSeasonName} scope={scope} fullTag={fullTag}
                promo={promoTiles} promoSeason={promoSeasonName} locationNames={locationNames}
                headerExtra={seasonToggle("bookingSeason", bookingSeason)} />
            </Suspense>
          </>
        )}
      </div>

      {!isReg && (
        <p className="text-xs text-glass-text-tertiary">
          Feedback, Stats Health, and Content Health read live from each source, scoped to the selected Season, Location,
          and League manager (locations reconciled across apps by fuzzy match). Registrations, the Promo Tracker and Facility
          Bookings run one season ahead — the season being sold — and each carries a toggle beside its heading to read it on
          the season being played instead; the Checklist shows both. The Promo Tracker card reads live from the Promo
          Tracker&apos;s own KPI feed, so its numbers match that site exactly.
        </p>
      )}
    </main>
  );
}

// Which basis a section is reading on, worn as the selected half of a toggle
// without the other half: on Weekly review most sections are week-scoped and a
// few still read the season, and "(Full Season)" in grey next to a heading was
// easy to slide past. There is nothing to choose here — the tabs at the top of
// the page already made the choice — so it is a badge, not a control.
function ScopeTag({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-lg border p-0.5 shrink-0 align-middle"
      style={{ borderColor: "var(--glass-border)" }}>
      <span className="px-2.5 py-1 rounded-md"
        style={{ fontSize: 11, fontWeight: 600, background: "var(--glass-gold)", color: "#000" }}>
        {label}
      </span>
    </span>
  );
}

// Every section's way out to the app behind it. A button rather than a line of
// gold text: it is the one thing on a heading row you can click, and it was
// reading as a caption next to the tag beside it.
function MoreDetails({ href, label = "More details →" }: { href: string; label?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center shrink-0 rounded-md border border-glass-gold px-2.5 py-1 text-[11px] sm:text-[10px] uppercase tracking-[0.14em] font-bold text-glass-gold hover:bg-glass-gold hover:text-black transition-colors">
      {label}
    </a>
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
// Facilities reads the facilities app's OWN booking feed, so team capacity
// matches its calendar exactly (courts x hours x 2). Null -> section omitted.
type BookingLoc = {
  location: string; nights: number; teams: number; teams_per_week?: number;
  days?: string[]; days_to_book?: string[];
  by_day?: { day: string; teams: number; teams_capacity?: number; by_status: Record<string, number> }[];
  by_status: Record<string, number>; off: number;
};
type BookingData = {
  season: string | null;
  locations: BookingLoc[];
  totals: {
    nights: number; teams: number; to_book: number; locations: number;
    teams_per_week?: number; teams_week_one?: number; week_one?: string | null;
    teams_week_one_by_status?: Record<string, number>;
    nights_per_week?: number; nights_to_book?: number;
    by_status: Record<string, number>;
  } | null;
};
const BOOKING_STATUS_LABEL: Record<string, string> = {
  cannot_book_until_later: "Cannot book yet",
  booked_with_contract: "Contract",
  booked_with_flexibility: "Flexible",
  verbal_confirmation: "Verbal",
  in_communication: "In comms",
  need_to_book: "Need to book",
};
// Ordered from firmest to least committed, so a row reads left to right.
const BOOKING_STATUS_ORDER = ["booked_with_contract", "booked_with_flexibility", "verbal_confirmation", "in_communication", "cannot_book_until_later", "need_to_book"];
const BOOKING_STATUS_COLOR: Record<string, string> = {
  cannot_book_until_later: "var(--glass-text-tertiary)",
  booked_with_contract: "rgb(74,222,128)",
  booked_with_flexibility: "rgb(74,222,128)",
  verbal_confirmation: "var(--glass-gold)",
  in_communication: "var(--glass-text-secondary)",
  need_to_book: "rgb(248,113,113)",
};
const DOW_WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const BOOKING_STATUS_TONE: Record<string, Tone> = {
  booked_with_contract: "ok",
  booked_with_flexibility: "ok",
  verbal_confirmation: "warn",
  in_communication: "default",
  cannot_book_until_later: "default",
  need_to_book: "bad",
};
// A location is only as booked as its firmest day: one signed night makes it
// green even while other nights are still being chased.
const firmestStatus = (l: BookingLoc) =>
  BOOKING_STATUS_ORDER.find((s) => (l.by_status[s] ?? 0) > 0) ?? "need_to_book";

async function loadBookings(season: string, scope: Scope): Promise<BookingData | null> {
  try {
    const url = new URL("/api/dashboard-kpis", "https://brodie-facilities.vercel.app");
    url.searchParams.set("season", season);
    const lp = locParam(scope.locationNames); if (lp) url.searchParams.set("location", lp);
    const res = await promoFetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as BookingData;
    return k.locations ? k : null;
  } catch {
    return null;
  }
}

function BookingsSection({ data, season, titleSuffix = "", teamsRegistered, teamsFullRoster, venueRegs, scopeLocations, headerExtra }: { data: BookingData; season: string; titleSuffix?: string; teamsRegistered?: number; teamsFullRoster?: number | null; venueRegs?: VenueRegs[]; scopeLocations?: string[] | null; headerExtra?: ReactNode }) {
  // Registrations arrive keyed by the ops league's venue name, which spells a
  // market slightly differently from the facilities calendar, and name their
  // night in full where the calendar abbreviates it.
  const SHORT_DAY: Record<string, string> = {
    sunday: "Sun", monday: "Mon", tuesday: "Tue", wednesday: "Wed",
    thursday: "Thu", friday: "Fri", saturday: "Sat",
  };
  const shortDay = (d: string | null) => (d ? SHORT_DAY[d.trim().toLowerCase()] ?? d.trim().slice(0, 3) : null);
  // Every night a venue has signups on, whether or not it has been booked.
  const regDaysFor = (loc: string) => {
    const m = new Map<string, { teams: number; full: number; low: number; players: number }>();
    for (const v of venueRegs ?? []) {
      if (!sameLocation(v.venue, loc)) continue;
      const d = shortDay(v.day ?? null);
      if (!d) continue;
      const cur = m.get(d) ?? { teams: 0, full: 0, low: 0, players: 0 };
      cur.teams += v.teams_registered;
      cur.full += v.full_roster ?? 0;
      cur.low += v.low_roster ?? 0;
      cur.players += v.players ?? 0;
      m.set(d, cur);
    }
    return m;
  };
  const t = data.totals;
  const locTone = (l: BookingLoc) => BOOKING_STATUS_TONE[firmestStatus(l)] ?? "default";
  // A market with signups but nothing on the calendar has no row in the
  // bookings feed at all, so it used to drop out of the list entirely — the one
  // case you would most want to see. Ottawa had 26 teams registered for Fall
  // and no Fall bookings, and simply was not listed.
  const regOnly: BookingLoc[] = [...new Set((venueRegs ?? []).map((v) => v.venue))]
    .filter((venue) => !data.locations.some((l) => sameLocation(venue, l.location)))
    // Only markets the view actually asked for. Without this, a feed that
    // ignores the location filter drags every other market into a filtered
    // view — which is exactly what happened when the registration feed
    // returned all 26 venues under ?location=Vaughan.
    .filter((venue) => !scopeLocations?.length || scopeLocations.some((n) => sameLocation(venue, n)))
    .map((venue) => ({ location: venue, nights: 0, teams: 0, by_status: {}, off: 0, by_day: [] }));
  const locations = [...data.locations, ...regOnly].sort((a, b) => a.location.localeCompare(b.location));
  // Footed by walking the same nights the rows are built from, rather than by
  // reading a separate total — a footer that disagrees with the column above it
  // is worse than no footer. Registered teams come from the nights that have
  // them, capacity from every night, and the status pills count nights.
  const totals = locations.reduce(
    (acc, l) => {
      const regDays = regDaysFor(l.location);
      for (const n of l.by_day ?? []) {
        acc.booked += n.teams_capacity ?? n.teams;
        const firm = BOOKING_STATUS_ORDER.find((s) => (n.by_status[s] ?? 0) > 0) ?? "need_to_book";
        acc.byStatus[firm] = (acc.byStatus[firm] ?? 0) + 1;
        acc.nights += 1;
      }
      for (const r of regDays.values()) {
        acc.registered += r.teams;
        acc.full += r.full;
        acc.low += r.low;
        acc.players += r.players;
      }
      return acc;
    },
    { registered: 0, booked: 0, full: 0, low: 0, players: 0, nights: 0, byStatus: {} as Record<string, number> },
  );
  const secured = locations.filter((l) => locTone(l) === "ok" || locTone(l) === "warn").length;
  const statusPill = (s: string, n?: number) => (
    <span key={s} className="text-[11px] rounded-md px-1.5 py-0.5 border whitespace-nowrap"
      style={{
        color: BOOKING_STATUS_COLOR[s] ?? "var(--glass-text-secondary)",
        borderColor: s === "need_to_book" ? "rgba(239,68,68,0.35)" : "var(--glass-border)",
        background: s === "need_to_book" ? "rgba(239,68,68,0.10)" : "transparent",
      }}>
      {BOOKING_STATUS_LABEL[s] ?? s}{n != null && <> <span className="font-bold tabular">{n}</span></>}
    </span>
  );
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h2 className="text-lg font-semibold" style={{ color: "var(--glass-text)" }}>Facility Bookings</h2>
          {titleSuffix && <ScopeTag label={titleSuffix} />}
          {headerExtra ?? (
            <span className="text-[10px] sm:text-[9px] uppercase tracking-[0.16em] font-bold px-1.5 py-0.5 rounded"
              style={{ background: "var(--glass-gold-light, rgba(255,184,0,0.16))", color: "var(--glass-gold)" }}>{season}</span>
          )}
        </div>
        <MoreDetails href={APP_URL.facilities} />
      </div>

      <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
        {/* Teams actually registered against the capacity booked for them, so
            the two read side by side rather than needing a second card. */}
        <StatTile
          label={teamsRegistered != null ? "Teams registered" : "Teams booked for"}
          value={(teamsRegistered ?? t?.teams_week_one ?? 0).toLocaleString()}
          tone="default"
          lines={teamsFullRoster != null
            ? [{ text: `${teamsFullRoster.toLocaleString()} with 7 or more players`, chip: true }]
            : undefined}
          corner={teamsRegistered != null
            ? {
                // Capacity is per night, so the comparable figure is one week's
                // worth — week 1 of the regular season, not the season's nights
                // added together.
                label: "Teams booked",
                value: (t?.teams_week_one ?? 0).toLocaleString(),
                color: "var(--glass-gold)",
                // How firm week 1 is, not just how big.
                lines: BOOKING_STATUS_ORDER
                  .filter((s) => (t?.teams_week_one_by_status?.[s] ?? 0) > 0)
                  .map((s) => ({
                    text: `${(t!.teams_week_one_by_status![s]).toLocaleString()} ${BOOKING_STATUS_LABEL[s]}`,
                    color: BOOKING_STATUS_COLOR[s],
                  })),
              }
            : undefined}
        />
        <StatTile label="Locations secured" value={`${secured}`} unit={`/ ${locations.length}`}
          valueSuffix={locations.length ? `${Math.round((secured / locations.length) * 100)}%` : undefined}
          sub="a contract or verbal on at least one night"
          tone={secured === locations.length ? "ok" : "warn"}
          // The whole roster, each location tinted by its firmest status, so the
          // red ones are read against everywhere else rather than on their own.
          // The count above is the green and gold chips, so the two agree.
          pills={[...locations]
            .sort((a, b) => a.location.localeCompare(b.location))
            .map((l) => ({ text: l.location, tone: locTone(l) }))}
          pillsEmpty="no locations" />
      </div>

      <div className="rounded-2xl border border-glass-border bg-glass-surface">
        <table className="w-full text-sm">
          {/* Sticky per cell rather than on the row: the page's scroll container
              starts directly under the nav, so top:0 lands flush against it. */}
          <thead>
            <tr className="text-left text-[11px] sm:text-[10px] uppercase tracking-[0.18em] text-glass-text-tertiary">
              {[
                { label: "Location", align: "" },
                { label: "Night", align: "" },
                { label: "Teams registered", align: "text-right" },
                { label: "Teams booked", align: "text-right" },
                { label: "Booking status", align: "" },
              ].map((h) => (
                <th key={h.label}
                  className={`px-5 py-3 font-bold sticky top-0 z-[5] ${h.align}`}
                  style={{
                    // Rows share the card's surface, so a header on the same
                    // colour with a hairline under it just looks like the first
                    // row. A darker bar, a solid rule and a shadow underneath
                    // make it read as sitting above the content it covers.
                    // Tinting toward the text colour darkens the bar in light
                    // mode and lightens it in dark, so it separates from the
                    // rows either way — the page background only works in one.
                    background: "color-mix(in srgb, var(--glass-text) 9%, var(--glass-surface))",
                    boxShadow: "inset 0 -1px 0 var(--glass-border), 0 10px 14px -10px rgba(0,0,0,0.55)",
                  }}>
                  {h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {locations.flatMap((l) => {
              // A venue's nights are everything it has booked plus everything it
              // has signups for — a night people registered for but nobody has
              // booked is the gap worth seeing, so it gets a row of its own.
              const regDays = regDaysFor(l.location);
              const booked = l.by_day ?? [];
              const nights = [...new Set([...booked.map((n) => n.day), ...regDays.keys()])]
                .sort((a, b) => DOW_WEEK.indexOf(a) - DOW_WEEK.indexOf(b))
                .map((day) => booked.find((n) => n.day === day) ?? { day, teams: 0, teams_capacity: 0, by_status: {} });
              if (!nights.length) {
                return [(
                  <tr key={l.location} className="border-t border-glass-border align-top">
                    <td className="px-5 py-3 whitespace-nowrap font-semibold" style={{ color: "var(--glass-text)" }}>{l.location}</td>
                    <td className="px-5 py-3 font-semibold" style={{ color: "rgb(248,113,113)" }}>none booked</td>
                    <td className="px-5 py-3 text-right tabular text-glass-text-tertiary">—</td>
                    <td className="px-5 py-3 text-right tabular text-glass-text-tertiary">0</td>
                    <td className="px-5 py-3" />
                  </tr>
                )];
              }
              return nights.map((n, i) => {
                // The night takes the colour of the firmest thing booked on it,
                // so an unsecured Friday reads red inside an otherwise fine venue.
                const firm = BOOKING_STATUS_ORDER.find((s) => (n.by_status[s] ?? 0) > 0) ?? "need_to_book";
                const dayColor = BOOKING_STATUS_COLOR[firm] ?? "var(--glass-text)";
                const reg = regDays.get(n.day);
                return (
                  <tr key={`${l.location}|${n.day}`}
                    className={`align-top border-t ${i === 0 ? "border-glass-border" : "border-glass-border-light"}`}>
                    {i === 0 && (
                      <td rowSpan={nights.length} className="px-5 py-3 whitespace-nowrap align-top font-semibold"
                        style={{ color: "var(--glass-text)" }}>{l.location}</td>
                    )}
                    <td className="px-5 py-3 whitespace-nowrap font-semibold" style={{ color: dayColor }}>{n.day}</td>
                    <td className="px-5 py-3 text-right tabular align-top">
                      <div className="font-bold" style={{ color: reg ? "var(--glass-text)" : "var(--glass-text-tertiary)" }}>
                        {reg ? reg.teams.toLocaleString() : "—"}
                      </div>
                      {/* How many of the night's teams can field a side, and
                          how many have barely started. */}
                      {/* The average first — it describes the night as a whole; the
                          chips under it are the two tails. */}
                      {(!!reg?.full || !!reg?.low || !!reg?.teams) && (
                        <div className="mt-1 flex flex-col items-end gap-1">
                          {!!reg?.teams && (
                            <span className="inline-block text-[11px] sm:text-[10px] font-semibold rounded-md px-1.5 py-0.5 border whitespace-nowrap"
                              style={rosterChipStyle(reg.players / reg.teams)}>
                              {(reg.players / reg.teams).toFixed(1)} avg players per team
                            </span>
                          )}
                          {!!reg?.full && (
                            <span className="inline-block text-[11px] sm:text-[10px] font-semibold rounded-md px-1.5 py-0.5 border whitespace-nowrap"
                              style={{ color: "var(--glass-gold)", borderColor: "rgba(255,184,0,0.35)", background: "rgba(255,184,0,0.10)" }}>
                              {reg.full} with 7 or more players
                            </span>
                          )}
                          {!!reg?.low && (
                            <span className="inline-block text-[11px] sm:text-[10px] font-semibold rounded-md px-1.5 py-0.5 border whitespace-nowrap"
                              style={{ color: "rgb(248,113,113)", borderColor: "rgba(239,68,68,0.35)", background: "rgba(239,68,68,0.10)" }}>
                              {reg.low} with 3 or fewer players
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    {/* The night's own capacity, whatever its status — a night the
                        calendar shows as "12 teams" is 12 spots even while it is
                        still need-to-book. What is secured sits underneath when
                        the two differ. */}
                    <td className="px-5 py-3 text-right tabular align-top">
                      <div className="font-bold"
                        style={{ color: n.teams ? "var(--glass-gold)" : "var(--glass-text-tertiary)" }}>
                        {(n.teams_capacity ?? n.teams).toLocaleString()}
                      </div>
                      {(n.teams_capacity ?? 0) > n.teams && (
                        <div className="text-[11px] sm:text-[10px] mt-0.5 text-glass-text-tertiary">
                          {n.teams.toLocaleString()} booked
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {BOOKING_STATUS_ORDER.filter((s) => n.by_status[s]).map((s) => statusPill(s))}
                      </div>
                    </td>
                  </tr>
                );
              });
            })}
            {locations.length > 1 && (
              <tr className="align-top" style={{ borderTop: "2px solid var(--glass-border)" }}>
                <td className="px-5 py-3 whitespace-nowrap font-bold" style={{ color: "var(--glass-text)" }}>Total</td>
                <td className="px-5 py-3 whitespace-nowrap text-glass-text-tertiary">
                  {totals.nights} night{totals.nights === 1 ? "" : "s"} · {locations.length} locations
                </td>
                <td className="px-5 py-3 text-right tabular align-top">
                  <div className="font-bold" style={{ color: totals.registered ? "var(--glass-text)" : "var(--glass-text-tertiary)" }}>
                    {totals.registered ? totals.registered.toLocaleString() : "—"}
                  </div>
                  {!!totals.registered && (
                    <div className="mt-1 flex flex-col items-end gap-1">
                      <span className="inline-block text-[11px] sm:text-[10px] font-semibold rounded-md px-1.5 py-0.5 border whitespace-nowrap"
                        style={rosterChipStyle(totals.players / totals.registered)}>
                        {(totals.players / totals.registered).toFixed(1)} avg players per team
                      </span>
                      {!!totals.full && (
                        <span className="inline-block text-[11px] sm:text-[10px] font-semibold rounded-md px-1.5 py-0.5 border whitespace-nowrap"
                          style={{ color: "var(--glass-gold)", borderColor: "rgba(255,184,0,0.35)", background: "rgba(255,184,0,0.10)" }}>
                          {totals.full} with 7 or more players
                        </span>
                      )}
                      {!!totals.low && (
                        <span className="inline-block text-[11px] sm:text-[10px] font-semibold rounded-md px-1.5 py-0.5 border whitespace-nowrap"
                          style={{ color: "rgb(248,113,113)", borderColor: "rgba(239,68,68,0.35)", background: "rgba(239,68,68,0.10)" }}>
                          {totals.low} with 3 or fewer players
                        </span>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-5 py-3 text-right tabular align-top font-bold"
                  style={{ color: totals.booked ? "var(--glass-gold)" : "var(--glass-text-tertiary)" }}>
                  {totals.booked.toLocaleString()}
                </td>
                {/* Nights by their firmest status, which is what the column
                    above shows one night at a time. */}
                <td className="px-5 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    {BOOKING_STATUS_ORDER.filter((st) => totals.byStatus[st]).map((st) => statusPill(st, totals.byStatus[st]))}
                  </div>
                </td>
              </tr>
            )}
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
          {titleSuffix && <ScopeTag label={titleSuffix} />}
        </div>
        <MoreDetails href={`${APP_URL.feedback}/site-visits`} />
      </div>
      <div className="rounded-2xl border border-glass-border bg-glass-surface overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] sm:text-[10px] uppercase tracking-[0.18em] text-glass-text-tertiary border-b border-glass-border-light">
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
                  <div className="text-[11px] sm:text-[10px] text-glass-text-tertiary mt-0.5">prev: {prevWeekLabel(w.week_start)}</div>
                </td>
                <td className="px-5 py-3 text-right align-top">
                  <div className="tabular font-bold" style={{ color: "var(--glass-text)" }}>{w.count}</div>
                  <div className="text-[11px] sm:text-[10px] tabular text-glass-text-tertiary mt-0.5 whitespace-nowrap">{w.prev_count}</div>
                  <div className="text-[11px] sm:text-[10px] tabular whitespace-nowrap" style={{ color: upColor(w.count_delta) }}>{signedN(w.count_delta)}</div>
                </td>
                <td className="px-5 py-3 text-right align-top">
                  <div className="tabular font-semibold" style={{ color: TONE_COLOR[w.avg_tone] }}>{w.avg_score == null ? "—" : `${w.avg_score}%`}</div>
                  <div className="text-[11px] sm:text-[10px] tabular text-glass-text-tertiary mt-0.5 whitespace-nowrap">{w.prev_avg == null ? "—" : `${w.prev_avg}%`}</div>
                  {w.avg_delta != null && <div className="text-[11px] sm:text-[10px] tabular whitespace-nowrap" style={{ color: upColor(w.avg_delta) }}>{signedN(w.avg_delta)}</div>}
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
          <span className="text-[11px] sm:text-[10px] uppercase tracking-[0.18em] font-bold text-glass-text-tertiary">By district manager</span>
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
          {titleSuffix && <ScopeTag label={titleSuffix} />}
        </div>
        <MoreDetails href={`${APP_URL.feedback}/video-review`} />
      </div>
      <div className="rounded-2xl border border-glass-border bg-glass-surface overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] sm:text-[10px] uppercase tracking-[0.18em] text-glass-text-tertiary border-b border-glass-border-light">
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
                  <div className="text-[11px] sm:text-[10px] text-glass-text-tertiary mt-0.5">prev: {prevWeekLabel(w.week_start)}</div>
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
                        <div className="text-[11px] sm:text-[10px] tabular text-glass-text-tertiary mt-0.5 whitespace-nowrap">
                          {w.prev_reviewed}/{w.prev_nights} {prevPct == null ? "—" : `${prevPct}%`}
                        </div>
                        <div className="text-[11px] sm:text-[10px] tabular whitespace-nowrap" style={{ color: upColor(dPts ?? 0) }}>
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
          <span className="text-[11px] sm:text-[10px] uppercase tracking-[0.18em] font-bold text-glass-text-tertiary">Completed by location</span>
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
  emptyNote,
  seasonTag,
  scopeTag,
  headerExtra,
  cols = 4,
}: {
  title: string;
  href?: string;
  // null = the source app couldn't be reached. The section then says so and
  // shows no numbers — never placeholder figures, which read as real.
  tiles: Tile[] | null;
  // Sits beside the heading — a control that belongs to this section alone,
  // rather than to the filter bar every section shares.
  headerExtra?: ReactNode;
  // Shown instead of the "coming soon" line when the section has no tiles
  // because the source does not cover the selected locations.
  emptyNote?: string;
  seasonTag?: string;
  // Scope note beside the heading ("(Weekly)"), set smaller and muted so it
  // reads as a label rather than part of the title.
  scopeTag?: string;
  // Sections with more or fewer than four tiles can ask for a different grid so
  // the row neither wraps nor leaves a hole. Class names are spelled out
  // because Tailwind scans literals.
  cols?: 3 | 4 | 6;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h2 className="text-lg font-semibold" style={{ color: "var(--glass-text)" }}>{title}</h2>
          {scopeTag && <ScopeTag label={scopeTag} />}
          {seasonTag && (
            <span className="text-[10px] sm:text-[9px] uppercase tracking-[0.16em] font-bold px-1.5 py-0.5 rounded"
              style={{ background: "var(--glass-gold-light, rgba(255,184,0,0.16))", color: "var(--glass-gold)" }}>
              {seasonTag}
            </span>
          )}
          {tiles === null && (
            <span className="text-[10px] sm:text-[9px] uppercase tracking-[0.16em] font-bold px-1.5 py-0.5 rounded"
              style={{ background: "rgba(239,68,68,0.12)", color: "var(--glass-danger-text, rgb(248,113,113))" }}>
              not connected
            </span>
          )}
          {headerExtra}
        </div>
        {href && <MoreDetails href={href} />}
      </div>
      {tiles === null ? (
        <div className="rounded-xl border border-glass-border bg-glass-surface px-4 py-6 text-sm text-glass-text-tertiary">
          <span className="font-semibold" style={{ color: "var(--glass-text-secondary)" }}>Not connected.</span>{" "}
          League Health couldn&apos;t load {title} from its app, so no numbers are shown here.
          {href && <> Open the app for the current figures.</>}
        </div>
      ) : tiles.length ? (
        <div className={cols === 6
          ? "grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6"
          : cols === 3
            ? "grid gap-3 grid-cols-1 md:grid-cols-3"
            : "grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4"}>
          {tiles.map((t, i) => <StatTile key={i} {...t} />)}
        </div>
      ) : (
        <div className="rounded-xl border border-glass-border bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary">
          {emptyNote ?? "Cards coming soon — open the app for the full view."}
        </div>
      )}
    </section>
  );
}

