// Discount names are written with the season in front — "Coldest Winter 2027
// Returning Player Discount" — which is the half you already know from the
// season filter, and the half that pushes the part you don't off the end of a
// column. Callers keep the full name on hover.
const SEASON_PREFIX =
  /^(?:the\s+)?(?:coldest\s+winter|brodie\s+summer|bracket\s+season|slasher\s+season|winter|summer|spring|fall)\s*'?\d{0,4}\s+/i;

export const shortDiscount = (name: string) =>
  name.split(", ").map((n) => n.replace(SEASON_PREFIX, "").trim() || n).join(", ");
