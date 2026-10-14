// Matching one app's name for a location against another's.

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
export const canonLoc = (s: string) => {
  const f = flattenLoc(s);
  return LOCATION_ALIASES[f] ?? f;
};
export function sameLocation(a: string, b: string): boolean {
  const x = canonLoc(a), y = canonLoc(b);
  if (x === y) return true;
  if (x.includes(y) || y.includes(x)) return x.split(" ")[0] === y.split(" ")[0];
  return false;
}
