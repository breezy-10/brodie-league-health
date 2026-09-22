// The canonical location list, from brodie-districts.
//
// Districts publishes /api/locations as the source of truth every Brodie ops
// app is meant to read, and it is the only list that carries the venue splits
// in the spelling the ops database uses — "Brooklyn (Bushwick)", not
// "Brooklyn - Bushwick"; three Boston venues and three Calgary ones rather than
// one of each. Reading the Promo Tracker's own table instead left this app with
// 26 locations against the real 36, some of them named differently from every
// other app, which is what broke cross-app matching for the Brooklyn pair.
const DISTRICTS_LOCATIONS_URL = "https://brodie-districts.vercel.app/api/locations";

// Not a real market — it exists in districts for testing and has no business in
// a filter.
const EXCLUDE = new Set(["test league"]);

// Last known good copy of that feed, for when it cannot be reached. Districts
// already omits hidden (retired) venues, so this is simply its output.
export const LOCATIONS_FALLBACK = [
  "Boston (Middleton)", "Boston (Stoughton)", "Boston (Walpole)", "Brampton (Game6)",
  "Brooklyn (Bushwick)", "Brooklyn (Greenpoint)", "Burlington", "Burnaby",
  "Calgary (Central)", "Calgary (North)", "Calgary (South)", "Chicago (Homer Glen)",
  "Dallas", "Edmonton", "Houston", "Kitchener", "London", "Markham", "Milton",
  "Mississauga", "Montreal", "New Jersey", "Niagara", "Oakville", "Oshawa", "Ottawa",
  "Richmond", "Scarborough", "Surrey", "Toronto (Downtown)", "Toronto (Uptown)",
  "Toronto PRO-AM", "Vaughan", "Victoria", "Winnipeg",
];

const alphabetical = (names: string[]) => [...names].sort((a, b) => a.localeCompare(b));

// One fetch per request. Several callers ask for this list while rendering a
// single page.
let inflight: Promise<string[]> | null = null;

export async function getCanonicalLocations(): Promise<string[]> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(DISTRICTS_LOCATIONS_URL, { next: { revalidate: 300 } });
      if (!res.ok) return alphabetical(LOCATIONS_FALLBACK);
      const body = (await res.json()) as { locations?: { name: string | null }[] };
      const names = (body.locations ?? [])
        .map((l) => l.name)
        .filter((n): n is string => !!n && !EXCLUDE.has(n.trim().toLowerCase()));
      return names.length ? alphabetical(names) : alphabetical(LOCATIONS_FALLBACK);
    } catch {
      return alphabetical(LOCATIONS_FALLBACK);
    } finally {
      // Only the in-flight request is shared; the next render fetches again
      // (the response itself is cached for five minutes).
      inflight = null;
    }
  })();
  return inflight;
}
