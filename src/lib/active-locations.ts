// Which locations have at least one captain registered for a season.
//
// Location filters list only these, so a location with no teams for the
// season being looked at (Atlanta in Fall '26) doesn't sit in the list reading
// as zero. The Promo Tracker publishes the one definition every Brodie app
// shares: a completed, uncancelled captain registration with a team.
const ACTIVE_LOCATIONS_URL = "https://registration-promo-tracker.vercel.app/api/active-locations";

const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Keys of the locations with a captain in these seasons, by ops league name and
 * Promo Tracker name. No seasons = every season in play or open for
 * registration. null when the feed can't be read — callers then keep every
 * location, since hiding them all would be worse than not filtering.
 */
export async function getActiveLocationKeys(seasons: string[]): Promise<Set<string> | null> {
  try {
    const qs = seasons.map((s) => `season=${encodeURIComponent(s)}`).join("&");
    const res = await fetch(`${ACTIVE_LOCATIONS_URL}${qs ? `?${qs}` : ""}`, { next: { revalidate: 600 } });
    if (!res.ok) return null;
    const body = (await res.json()) as { locations?: string[]; leagues?: { name: string }[] };
    if (!Array.isArray(body.locations)) return null;
    return new Set([...body.locations, ...(body.leagues ?? []).map((l) => l.name)].map(key));
  } catch {
    return null;
  }
}

/** The names in `all` that are active, plus any already selected. */
export function onlyActive(all: string[], active: Set<string> | null, selected: string[] = []): string[] {
  if (!active) return all;
  const keep = new Set(selected.map(key));
  return all.filter((n) => active.has(key(n)) || keep.has(key(n)));
}
