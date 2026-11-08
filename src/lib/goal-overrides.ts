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
    "New Jersey (Mountainside)|Thursday": 8,
    "Chicago (Pullman)|Saturday": 12,
    "Calgary (Central)|Thursday": 8,
    "Edmonton|Sunday": 10,
    "Seattle (Capitol Hill)|Friday": 24,
    "Richmond|Sunday": 8,
  },
};
