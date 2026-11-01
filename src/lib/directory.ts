/**
 * brodie-districts' directory: the one list of locations and who manages them,
 * which every Brodie app syncs from instead of keeping its own copy
 * (brodie-districts src/lib/directory.ts, GET /api/directory).
 *
 * Env: DIRECTORY_FEED_TOKEN (required), DISTRICTS_URL (optional, defaults to
 * the production app). This file is the same in every app that reads it.
 */

export type DirectoryPerson = { name: string; email: string | null };

export type DirectorySeason = {
  key: string;
  name: string | null;
  start_date: string | null;
  end_date: string | null;
  team_count: number;
  nights: string[];
};

export type DirectoryLocation = {
  /** spt_leagues.id, the ops league id. Stable across renames: key on this. */
  id: string;
  name: string;
  slug: string | null;
  short_name: string | null;
  district: string | null;
  /** Active in districts. Inactive rows are placeholders for markets not open yet. */
  is_active: boolean;
  /** Has teams in a season that's on now. */
  running: boolean;
  /** The webapi / stats facility id (ext_facilities.id). */
  stats_facility_id: string | null;
  /** brodie-facilities facilities.id. */
  facilities_id: string | null;
  facility_name: string | null;
  address: string | null;
  city: string | null;
  state_code: string | null;
  country_code: string | null;
  latitude: number | null;
  longitude: number | null;
  /** IANA time zone. */
  timezone: string;
  currency: "CAD" | "USD";
  current_season_name: string | null;
  nights: string[];
  /** Season keys ("winter-2027") that count as now for this location. */
  seasons_now: string[];
  /** The location's ops seasons from the last year on, oldest first, with its own dates and nights. */
  seasons: DirectorySeason[];
  /** Everyone managing the location in a season that's on now (per-night picks included). */
  league_managers: DirectoryPerson[];
  district_managers: DirectoryPerson[];
  operations_managers: DirectoryPerson[];
  night_season: string | null;
  /** Night ("Tuesday") -> who runs it, for the season in play (else the next). */
  night_managers: Record<string, { league_managers: DirectoryPerson[]; district_managers: DirectoryPerson[] }>;
  slack_channel_id: string | null;
  slack_growth_channel_id: string | null;
};

export type Directory = {
  generated_at: string;
  season: string;
  locations: DirectoryLocation[];
  people: (DirectoryPerson & { roles: string[]; active: boolean })[];
};

const DISTRICTS_URL = (process.env.DISTRICTS_URL ?? "https://brodie-districts.vercel.app").replace(/\/$/, "");

/** The directory, or null when it isn't configured or can't be read. Callers
 *  must treat null as "skip this run", never as "no locations". */
export async function fetchDirectory(): Promise<Directory | null> {
  const token = process.env.DIRECTORY_FEED_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`${DISTRICTS_URL}/api/directory`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Directory;
    return Array.isArray(body?.locations) && body.locations.length > 0 ? body : null;
  } catch {
    return null;
  }
}

export const normEmail = (e: string | null | undefined) => (e ?? "").trim().toLowerCase();
export const normName = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
