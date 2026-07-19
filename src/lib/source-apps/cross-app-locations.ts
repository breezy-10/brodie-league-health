/**
 * Cross-app location resolution.
 *
 * LMs are accountable for outcomes at their assigned locations across every
 * Brodie source app. But each app maintains its own `locations` (or
 * `facilities`) table with slightly different naming conventions:
 *
 *   CRM:            "Brampton (Game6)"     "Brooklyn (Bushwick)"   "Calgary"
 *   ref_payroll:    "Brampton"             "Brooklyn"              "Calgary North/South"
 *   stats_health:   "Brampton"             "Brooklyn"              "Calgary North/South"
 *   content_health: "Brampton"             "Brooklyn"              "Calgary North/South"
 *   training:       "Brampton"             "Bushwick"              "Calgary"
 *   facilities:     city="Brampton"        city="Brooklyn (Bushwick)" city="Calgary (North)"
 *
 * This helper resolves an LM's assigned location names from CRM to the
 * corresponding row IDs (or city strings, for facilities) in each target app.
 *
 * Matching strategy (case-insensitive, accent-stripped):
 *   1. exact match on normalized name
 *   2. exact match after stripping parenthetical content from either side
 *   3. one-word-contains-other (e.g. "Brampton" matches "Brampton (Game6)")
 *
 * Caches results within a single sync run via the module-level Maps; clear
 * via `clearLocationCache()` between runs if needed.
 */
import { sourceClient } from "./clients";
import type { AppSlug } from "./clients";

type Norm = string;

function normalize(s: string): Norm {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function stripParen(s: string): Norm {
  return normalize(s.replace(/\s*\([^)]*\)\s*/g, " ").trim());
}

function fuzzyMatch(crmNames: string[], candidate: string): boolean {
  const n = normalize(candidate);
  const ns = stripParen(candidate);
  for (const cn of crmNames) {
    const a = normalize(cn);
    const ai = stripParen(cn);
    if (a === n || ai === n || a === ns || ai === ns) return true;
    // word-contains: at least one side contains the other and shares the
    // first word — guards against "Brooklyn" matching "Brookline" etc.
    if (a.includes(n) || n.includes(a)) {
      const af = a.split(" ")[0];
      const nf = n.split(" ")[0];
      if (af === nf) return true;
    }
  }
  return false;
}

// In-process caches keyed by sync run.
let crmManagersCache: Map<string /*email*/, string[] /*locationNames*/> | null = null;

async function getCRMLocationNamesForLM(lmEmail: string): Promise<string[]> {
  if (!crmManagersCache) {
    const crm = sourceClient("crm");
    if (!crm) return [];
    const [{ data: managers }, { data: locations }] = await Promise.all([
      crm.from("managers").select("email, assigned_locations"),
      crm.from("locations").select("id, name"),
    ]);
    const locById = new Map(
      ((locations ?? []) as Array<{ id: string; name: string }>).map((l) => [l.id, l.name])
    );
    crmManagersCache = new Map();
    for (const m of (managers ?? []) as Array<{ email: string; assigned_locations: string[] | null }>) {
      const names = (m.assigned_locations ?? [])
        .map((id) => locById.get(id))
        .filter((n): n is string => !!n);
      crmManagersCache.set(m.email.toLowerCase(), names);
    }
  }
  return crmManagersCache.get(lmEmail.toLowerCase()) ?? [];
}

/**
 * Returns the location row IDs in the target app that correspond to the LM's
 * CRM-assigned locations. Target app must have a `locations` table with
 * `id` + `name`. Use `resolveFacilityCitiesForLM` for facilities.
 */
const locationCache = new Map<string, string[]>(); // key: appSlug + ':' + email
export async function resolveLocationsForLM(
  appSlug: Exclude<AppSlug, "facilities" | "crm">,
  lmEmail: string
): Promise<string[]> {
  const cacheKey = `${appSlug}:${lmEmail.toLowerCase()}`;
  const hit = locationCache.get(cacheKey);
  if (hit) return hit;

  const crmNames = await getCRMLocationNamesForLM(lmEmail);
  if (!crmNames.length) {
    locationCache.set(cacheKey, []);
    return [];
  }

  const target = sourceClient(appSlug);
  if (!target) {
    locationCache.set(cacheKey, []);
    return [];
  }
  const { data: locs } = await target.from("locations").select("id, name");
  const matchIds = ((locs ?? []) as Array<{ id: string; name: string }>)
    .filter((l) => fuzzyMatch(crmNames, l.name))
    .map((l) => l.id);
  locationCache.set(cacheKey, matchIds);
  return matchIds;
}

/**
 * Resolve a single location name (any app's naming) to the matching location
 * row IDs in the target app, using the same fuzzy matcher as the LM resolver.
 * Used by the dashboard's Location filter, where the selected value is one
 * app's location label that must be mapped into each source app.
 */
export async function resolveLocationIdsByName(
  appSlug: Exclude<AppSlug, "facilities" | "crm">,
  locationName: string
): Promise<string[]> {
  const cacheKey = `byname:${appSlug}:${normalize(locationName)}`;
  const hit = locationCache.get(cacheKey);
  if (hit) return hit;
  const target = sourceClient(appSlug);
  if (!target) {
    locationCache.set(cacheKey, []);
    return [];
  }
  const { data: locs } = await target.from("locations").select("id, name");
  const matchIds = ((locs ?? []) as Array<{ id: string; name: string }>)
    .filter((l) => fuzzyMatch([locationName], l.name))
    .map((l) => l.id);
  locationCache.set(cacheKey, matchIds);
  return matchIds;
}

/**
 * Facilities has no separate `locations` table; it scopes by `city`. Returns
 * the set of normalized city strings the LM is responsible for, suitable for
 * an `in.()` filter on facilities.city.
 */
export async function resolveFacilityCitiesForLM(lmEmail: string): Promise<string[]> {
  const cacheKey = `facilities:${lmEmail.toLowerCase()}`;
  const hit = locationCache.get(cacheKey);
  if (hit) return hit;

  const crmNames = await getCRMLocationNamesForLM(lmEmail);
  if (!crmNames.length) {
    locationCache.set(cacheKey, []);
    return [];
  }
  const fac = sourceClient("facilities");
  if (!fac) {
    locationCache.set(cacheKey, []);
    return [];
  }
  // Pull all distinct facility cities once and fuzzy-match.
  const { data: facs } = await fac.from("facilities").select("city");
  const cities = [...new Set(((facs ?? []) as Array<{ city: string }>).map((f) => f.city))];
  const matched = cities.filter((c) => fuzzyMatch(crmNames, c));
  locationCache.set(cacheKey, matched);
  return matched;
}

/**
 * Pull the canonical LM list straight from CRM managers. Source of truth
 * for who has accountability for what. Adapters should use this rather than
 * looking up profiles in the target app — most LMs don't have profiles in
 * facilities/ref_payroll/etc.
 */
export async function listLMsFromCRM(): Promise<Array<{ email: string; name: string; assigned_locations: string[] }>> {
  await getCRMLocationNamesForLM("noop@noop"); // forces the cache load
  const crm = sourceClient("crm");
  if (!crm) return [];
  const { data: managers } = await crm
    .from("managers")
    .select("email, name, role, active, assigned_locations")
    .eq("role", "league_manager")
    .eq("active", true);
  return ((managers ?? []) as Array<{ email: string; name: string; assigned_locations: string[] | null }>).map((m) => ({
    email: m.email,
    name: m.name,
    assigned_locations: m.assigned_locations ?? [],
  }));
}

/** Wipe caches at the start of each sync run. */
export function clearLocationCache(): void {
  crmManagersCache = null;
  locationCache.clear();
}
