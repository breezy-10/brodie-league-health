/**
 * Live, non-XP counters surfaced at the top of My Day. These are queried
 * fresh against the source apps every page load — they intentionally bypass
 * daily_snapshots so they always reflect right-now numbers.
 *
 * Source of truth: brodie-crm.leads where lead_type='current_player'. These
 * are populated by the CRM's Metabase → Player One sync (status='completed'
 * registrations in Player One). Closer to live than the local teams table.
 */
import { sourceClient, sourceConfigured } from "@/lib/source-apps/clients";

export type LiveCounters = {
  registered_athletes: number | null;
  registered_teams: number | null;
  source_available: boolean;
};

export async function loadLiveCounters(lmEmail: string): Promise<LiveCounters> {
  const empty: LiveCounters = {
    registered_athletes: null,
    registered_teams: null,
    source_available: false,
  };
  if (!sourceConfigured("crm")) return empty;
  const sb = sourceClient("crm")!;

  // LM's assigned CRM location ids (text array)
  const { data: mgr } = await sb
    .from("managers")
    .select("assigned_locations, role, active")
    .eq("email", lmEmail.toLowerCase())
    .maybeSingle();

  const locIds = ((mgr as { assigned_locations: string[] | null } | null)?.assigned_locations ?? []);
  if (!locIds.length) return { ...empty, source_available: true };

  // Athletes: exact count of current_player leads at this LM's locations
  const { count: athleteCount } = await sb
    .from("leads")
    .select("*", { count: "exact", head: true })
    .eq("lead_type", "current_player")
    .in("location_id", locIds);

  // Teams: distinct team_name from those leads. PostgREST doesn't expose
  // count(distinct), so we fetch team_name only (no other columns to keep
  // payload small) and dedupe in JS. Limit to 5000 just in case any
  // location has runaway data; well above realistic team counts.
  const { data: teamRows } = await sb
    .from("leads")
    .select("team_name")
    .eq("lead_type", "current_player")
    .in("location_id", locIds)
    .not("team_name", "is", null)
    .limit(5000);
  const teamSet = new Set(
    ((teamRows ?? []) as Array<{ team_name: string | null }>)
      .map((r) => r.team_name)
      .filter((n): n is string => !!n && n.trim().length > 0)
  );

  return {
    registered_athletes: athleteCount ?? 0,
    registered_teams: teamSet.size,
    source_available: true,
  };
}
