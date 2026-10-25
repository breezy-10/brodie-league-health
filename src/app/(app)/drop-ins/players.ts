// Which drop-ins the page shows: by players new to Brodie when they signed up
// (the default), by returning players, or both. The ?players= param.
export type PlayersFilter = "new" | "returning" | "both";

export const playersFilter = (v: string | undefined): PlayersFilter =>
  v === "returning" || v === "both" ? v : "new";

export const matchesPlayers = (isNew: boolean, f: PlayersFilter) => f === "both" || isNew === (f === "new");
