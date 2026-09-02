// Season + scope resolution shared by every filtered tab (Dashboard,
// Registrations, Referrals). It lives here rather than in one page so the tabs
// cannot drift: if the Registrations tab defaults to a different season than
// the Referrals tab, the same filter bar silently produces numbers that don't
// line up, which reads as a data bug rather than a UI one.
import { createAdminClient } from "@/lib/supabase/admin";
import { sourceClient, sourceConfigured } from "@/lib/source-apps/clients";
import { ymd } from "@/lib/source-apps/util";

// Fallbacks copied from the Registration Promo Tracker, used until the live
// PROMO_SUPABASE_* connection is configured (then these are replaced live).
// Mirrors the Promo Tracker's `locations` table, which is the canonical list
// every sister app is matched against. Used when PROMO_SUPABASE_* isn't
// configured — so a name that has drifted here silently filters to nothing
// everywhere downstream. "Toronto (Hoopdome)" was one: the market is named
// "Toronto (Uptown)" everywhere else, so selecting it matched no registrations,
// no promo rows and no bookings.
const PROMO_LOCATIONS_FALLBACK = [
  "Boston", "Brampton", "Burlington", "Brooklyn - Bushwick", "Brooklyn - Greenpoint",
  "Calgary", "Chicago", "Edmonton", "Kitchener", "London", "Markham", "Milton",
  "Mississauga", "Montreal", "Niagara", "Oshawa", "Ottawa", "Scarborough",
  "Toronto (Downtown)", "Toronto (Uptown)", "Vaughan", "Winnipeg",
  "Richmond", "Oakville", "Surrey", "Burnaby",
];
const PROMO_SEASONS_FALLBACK = ["Fall '26", "Summer '26"];

// Normalize a season label to term+2-digit-year: "Fall '26" / "Fall 2026" -> "fall26".
export function seasonKey(name: string): string {
  const term = name.toLowerCase().match(/fall|summer|winter|spring/)?.[0] ?? "";
  const yr = (name.match(/\d{2,4}/)?.[0] ?? "").slice(-2);
  return `${term}${yr}`;
}

// The registration/promo push runs one season ahead of play:
// "Summer '26" -> "Fall '26", "Fall '26" -> "Winter '27".
const SEASON_TERMS = ["winter", "spring", "summer", "fall"];
export function nextSeasonLabel(season: string): string {
  const term = season.toLowerCase().match(/winter|spring|summer|fall/)?.[0];
  const yy = parseInt((season.match(/\d{2,4}/)?.[0] ?? "").slice(-2), 10);
  if (!term || Number.isNaN(yy)) return season;
  const i = SEASON_TERMS.indexOf(term);
  const nextTerm = SEASON_TERMS[(i + 1) % 4];
  const nextYy = i === 3 ? yy + 1 : yy;
  return `${nextTerm[0].toUpperCase()}${nextTerm.slice(1)} '${String(nextYy).padStart(2, "0")}`;
}

// Oldest season offered in the filters. Ops has clean data back to here.
export const EARLIEST_SEASON = "Winter '25";

function parseSeason(name: string): { i: number; yy: number } | null {
  const term = name.toLowerCase().match(/winter|spring|summer|fall/)?.[0];
  const yy = parseInt((name.match(/\d{2,4}/)?.[0] ?? "").slice(-2), 10);
  if (!term || Number.isNaN(yy)) return null;
  return { i: SEASON_TERMS.indexOf(term), yy };
}
const seasonLabel = (i: number, yy: number) =>
  `${SEASON_TERMS[i][0].toUpperCase()}${SEASON_TERMS[i].slice(1)} '${String(yy).padStart(2, "0")}`;
const seasonRank = (s: { i: number; yy: number }) => s.yy * 4 + s.i;

// Every season from `earliest` through `latest` inclusive, oldest first. The
// promo tracker only lists the seasons it actively syncs, which is far fewer
// than the filters should offer.
export function seasonRange(earliest: string, latest: string): string[] {
  const a = parseSeason(earliest), b = parseSeason(latest);
  if (!a || !b || seasonRank(b) < seasonRank(a)) return [];
  const out: string[] = [];
  let { i, yy } = a;
  // Guard against a malformed label spinning this forever.
  for (let n = 0; n <= 60; n++) {
    out.push(seasonLabel(i, yy));
    if (i === b.i && yy === b.yy) break;
    if (i === 3) { i = 0; yy += 1; } else i += 1;
  }
  return out;
}

// "Summer '26" -> "SU'26", so two deltas fit on one line of a narrow card.
const TERM_ABBR: Record<string, string> = { winter: "W", spring: "SP", summer: "SU", fall: "F" };
export function shortSeason(name: string): string {
  const t = name.toLowerCase().match(/winter|spring|summer|fall/)?.[0];
  const yy = (name.match(/\d{2,4}/)?.[0] ?? "").slice(-2);
  return t ? `${TERM_ABBR[t]}'${yy}` : name;
}

export type ActiveLM = { id: string; full_name: string | null; email: string; location_name: string | null };

export async function loadActiveLMs(): Promise<ActiveLM[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("league_managers")
    .select("id, full_name, email, location_name")
    .eq("active", true)
    .order("full_name");
  return (data ?? []) as ActiveLM[];
}

// Which league manager covers which locations, from the districts app.
export async function loadLmCoverage(): Promise<{ lm: string; locations: string[] }[] | null> {
  try {
    const res = await fetch("https://brodie-districts.vercel.app/api/lm-coverage", { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as { coverage: { lm: string; locations: string[] }[] };
    return k.coverage ?? null;
  } catch {
    return null;
  }
}

// Filter params are comma-separated lists so several seasons / locations /
// league managers / weeks can be selected at once. "all" is the legacy
// single-select sentinel for "unfiltered" and is dropped.
export function csvParam(v?: string): string[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter((s) => s && s !== "all");
}

// Locations that have been renamed. A bookmark or shared link still carrying
// the old name has to keep working — otherwise it silently filters to nothing
// across every section, which reads as missing data rather than a stale URL.
const LOCATION_RENAMES: Record<string, string> = {
  "toronto (hoopdome)": "Toronto (Uptown)",
  "toronto hoopdome": "Toronto (Uptown)",
  "hoopdome": "Toronto (Uptown)",
};
export function canonicalLocation(name: string): string {
  return LOCATION_RENAMES[name.toLowerCase().trim()] ?? name;
}

export type Scope = {
  promoLocations: string[];
  promoSeasons: string[];
  /** The playing season the filter bar is set to. */
  selectedSeason: string;
  /** The season registration/promo work is running for — one ahead of play. */
  regSeason: string;
  /** Locations this view is scoped to. null = all; [] = the filter matches none. */
  locationNames: string[] | null;
};

// Resolve the filter bar (season / location) into the season labels and
// location list every tab queries with.
export async function resolveScope(
  params: { season?: string; location?: string; seasons?: string[]; locations?: string[] },
  // Tabs about registration work (Registrations, Referrals) default to the
  // season being registered for; the cross-app Dashboard defaults to the season
  // currently being played, which is where its other sections' data lives.
  opts: { defaultSeason?: "playing" | "registration" } = {},
): Promise<Scope> {
  const { season: seasonParam, location = "all" } = params;

  // Locations + seasons from the Registration Promo Tracker — live when the
  // PROMO_SUPABASE_* connection is wired, otherwise the copied fallbacks.
  let promoLocations = PROMO_LOCATIONS_FALLBACK;
  let promoSeasons = PROMO_SEASONS_FALLBACK;
  let currentSeason: string | undefined;
  if (sourceConfigured("promo")) {
    const promo = sourceClient("promo")!;
    const [locRes, seaRes] = await Promise.all([
      promo.from("locations").select("name, sort_order").order("sort_order"),
      promo.from("seasons").select("name, is_current").order("is_current", { ascending: false }),
    ]);
    const locNames = ((locRes.data ?? []) as { name: string | null }[]).map((l) => l.name).filter((n): n is string => !!n);
    if (locNames.length) promoLocations = locNames;
    const seaRows = (seaRes.data ?? []) as { name: string | null; is_current: boolean | null }[];
    const seaNames = seaRows.map((s) => s.name).filter((n): n is string => !!n);
    if (seaNames.length) promoSeasons = seaNames;
    currentSeason = seaRows.find((s) => s.is_current)?.name ?? undefined;
  }

  // Default to the active PLAYING season (today within its date range, per the
  // stats source) rather than the promo's registration season — that's where
  // the games/feedback/content/checklist data actually lives right now.
  let activeSeasonLabel: string | undefined;
  if (sourceConfigured("stats_health")) {
    const st = sourceClient("stats_health")!;
    const today = ymd(new Date());
    const { data } = await st.from("seasons").select("name, start_date, end_date");
    const active = ((data ?? []) as { name: string | null; start_date: string | null; end_date: string | null }[])
      .find((s) => s.start_date && s.end_date && s.start_date <= today && today <= s.end_date);
    if (active?.name) activeSeasonLabel = promoSeasons.find((s) => seasonKey(s) === seasonKey(active.name!)) ?? active.name;
  }
  // The season being played now. Registration tabs sit one ahead of it.
  const playingSeason = activeSeasonLabel || currentSeason || promoSeasons[0] || "current";
  const fallback = opts.defaultSeason === "registration" ? nextSeasonLabel(playingSeason) : playingSeason;
  const selectedSeason = seasonParam || fallback;

  // Offer the full back catalogue, newest first — not just the seasons the
  // promo tracker syncs. Anything selected stays in the list even if it falls
  // outside the range (a linked URL for a future season, say).
  const newest = [...promoSeasons, playingSeason, nextSeasonLabel(playingSeason), selectedSeason]
    .map((n) => ({ n, p: parseSeason(n) }))
    .filter((x): x is { n: string; p: { i: number; yy: number } } => !!x.p)
    .sort((a, b) => seasonRank(b.p) - seasonRank(a.p))[0]?.n ?? playingSeason;
  const range = seasonRange(EARLIEST_SEASON, newest).reverse();
  promoSeasons = [...new Set([...(range.length ? range : promoSeasons), selectedSeason])]
    .filter((n) => !!parseSeason(n))
    .sort((a, b) => seasonRank(parseSeason(b)!) - seasonRank(parseSeason(a)!));

  // Resolve the scope's location names. Several locations can be selected at
  // once and the scope is their union. null = unfiltered (all locations).
  const selectedLocations = params.locations?.length ? params.locations : (location !== "all" ? [location] : []);
  const locationNames: string[] | null = selectedLocations.length ? [...new Set(selectedLocations)] : null;

  return {
    // Alphabetical: the Promo Tracker's own sort_order appends new markets at
    // the end, which buries them under the scroll in the filter.
    promoLocations: [...promoLocations].sort((a, b) => a.localeCompare(b)),
    promoSeasons,
    selectedSeason,
    regSeason: nextSeasonLabel(selectedSeason),
    locationNames,
  };
}

// The ?location= value to send to a source app's KPI feed: a comma-separated
// list, a sentinel that matches nothing (empty scope), or undefined (all).
export function locParam(locationNames: string[] | null): string | undefined {
  if (!locationNames) return undefined;
  return locationNames.length ? locationNames.join(",") : " none";
}
