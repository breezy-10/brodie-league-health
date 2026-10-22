// City launchers: full-time staff opening a new market. Each has a discount
// code of their own rather than (or as well as) a referral link, and is
// credited a flat amount for every completed registration that used it. No
// payout for it is recorded in the admin, so the City launchers page is where
// it is counted.
//
// location is the ops league name, as the Promo Tracker's feeds label rows.
// codes are matched case-insensitively.
export type CityLauncher = {
  name: string;
  location: string;
  codes: string[];
  creditPerUse: number;
};

export const CITY_LAUNCHERS: CityLauncher[] = [
  { name: "Ron Darius", location: "Atlanta (Chamblee)", codes: ["RONDARIUS"], creditPerUse: 50 },
];

// Who can open the page: it carries what staff are owed and every player's
// discount, so league managers don't see it.
export const CITY_LAUNCHER_ROLES = ["super_admin", "dm", "operations_manager"] as const;
