// Team goals League Health uses instead of Player One's Goals tab, by season,
// then "location|day" with the location and day named as the registration
// feed names them. Set by Sohaib on 2026-11-08; Player One still has its own.
// The leaderboard applies them to each day, and moves a location's goal (and
// so its district's and the total) by the difference from Player One's.
// A set day's athlete goal is ATHLETES_PER_TEAM_GOAL per team, the ratio
// Player One's goals use.
export const ATHLETES_PER_TEAM_GOAL = 9;

export const TEAM_GOAL_OVERRIDES: Record<string, Record<string, number>> = {
  "Winter '27": {
    "Mississauga|Monday": 18,
    "Kitchener|Saturday": 12,
    "Markham|Monday": 18,
    "Burlington|Friday": 8,
    "Burlington|Saturday": 12,
    "Burlington|Sunday": 12,
    "Toronto (Downtown)|Sunday": 42,
    "Brooklyn (Greenpoint)|Tuesday": 8,
    "New Jersey (Mountainside)|Thursday": 8,
    "Chicago (Pullman)|Saturday": 12,
    "Calgary (Central)|Thursday": 8,
    "Edmonton|Sunday": 10,
    "Oshawa|Thursday": 8,
    "Oshawa|Saturday": 16,
    "Seattle (Capitol Hill)|Friday": 24,
    "Richmond|Sunday": 8,
  },
};

export type GoalKind = "teams" | "athletes";
// The part of a registration-pacing card the goals are read from.
type GoalCard = { location: string; day?: string; seasons: { kind: string; team_goal?: number | null; athlete_goal?: number | null }[] };

// A season's goal lookup, shared by the leaderboard and the location cards so
// the two always agree. A day's goal is League Health's where it sets one,
// else Player One's. A venue's is Player One's moved by each set day's
// difference from Player One's day goal, which needs that day's card in
// `nights` (the location_day breakdown); a set day with no card leaves the
// venue's goal as Player One has it. Returns null with no goal set, and
// undefined when the feed couldn't read goals and none is set here.
export function goalLookup(season: string, nights: GoalCard[] | null | undefined) {
  const overrides = TEAM_GOAL_OVERRIDES[season] ?? {};
  const key = (venue: string, day?: string) => `${venue}|${day ?? ""}`;
  const playerOne = (card: GoalCard | undefined, kind: GoalKind) => {
    const c = card?.seasons.find((s) => s.kind === "current");
    return kind === "teams" ? c?.team_goal : c?.athlete_goal;
  };
  const set = (k: string, kind: GoalKind) => overrides[k] * (kind === "teams" ? 1 : ATHLETES_PER_TEAM_GOAL);
  const nightByKey = new Map((nights ?? []).map((l) => [key(l.location, l.day), l]));
  return {
    overrides,
    // venue and day name the card; a venue card has no day. `card` is where
    // Player One's goal is read, which is the day's own card for a day.
    goal(venue: string, day: string | undefined, card: GoalCard, kind: GoalKind): number | null | undefined {
      const feed = playerOne(card, kind);
      if (day) return key(venue, day) in overrides ? set(key(venue, day), kind) : feed;
      const setDays = Object.keys(overrides).filter((k) => k.startsWith(`${venue}|`) && nightByKey.has(k));
      return setDays.length
        ? setDays.reduce((g, k) => g + set(k, kind) - (playerOne(nightByKey.get(k), kind) ?? 0), feed ?? 0)
        : feed;
    },
  };
}
