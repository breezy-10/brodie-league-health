// Which locations have at least one captain registered for a season.
//
// Location filters list only these, so a location with no teams for the
// season being looked at (Atlanta in Fall '26) doesn't sit in the list reading
// as zero. The Promo Tracker publishes the one definition every Brodie app
// shares: a completed, uncancelled captain registration with a team.
const ACTIVE_LOCATIONS_URL = "https://registration-promo-tracker.vercel.app/api/active-locations";

const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
/** The comparison key both helpers below use: case and punctuation dropped. */
export const locationKey = key;

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

/**
 * Keys of the locations opening in these seasons: their first season with a
 * captain is one of them. Keyed by ops league name and Promo Tracker name, as
 * getActiveLocationKeys is. null when the feed can't tell, so a caller can
 * say so rather than guess which locations are new.
 */
export async function getNewLocationKeys(seasons: string[]): Promise<Set<string> | null> {
  try {
    const qs = seasons.map((s) => `season=${encodeURIComponent(s)}`).join("&");
    const res = await fetch(`${ACTIVE_LOCATIONS_URL}${qs ? `?${qs}` : ""}`, { next: { revalidate: 600 } });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      new_locations?: string[];
      leagues?: { name: string; location: string | null }[];
    };
    if (!Array.isArray(body.new_locations)) return null;
    const opened = new Set(body.new_locations.map(key));
    const keys = new Set(opened);
    for (const l of body.leagues ?? []) {
      if (opened.has(key(l.location ?? l.name))) keys.add(key(l.name));
    }
    return keys;
  } catch {
    return null;
  }
}
