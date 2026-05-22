import type { Adapter, AdapterResult, LMRollup } from "../types";
import { sourceClient, sourceConfigured } from "../clients";
import { ymd, daysAgo, pctScore } from "../util";

/**
 * brodie-crm verified schema:
 *   managers: id, email, name, role, assigned_locations (text[] of location ids), active
 *   locations: id (text), name
 *   leads: id, email, status (enum: new|contacted|engaged|hot|closing|registered|lost),
 *          location_id (text), assigned_manager_id, created_at
 *   activities: lead_id, manager_id, channel, direction (outbound|inbound|system),
 *               outcome, created_at
 *   teams: location_id (text), season (text), status (forming|full|registered|cancelled)
 *   season_captain_goals: location_id (text), season (text), target (int)
 *
 * Sub-metrics:
 *   reg_pace          (50%) — registered+full teams vs season target for LM's locations
 *   lead_response_sla (30%) — % new leads (last 7d) with first outbound activity in <24h
 *   captain_followup  (20%) — % active leads (status in new|contacted|engaged|hot|closing)
 *                              with an activity in the last 7 days
 */
export const crmAdapter: Adapter = {
  slug: "crm",
  async sync(snapshotDate: Date): Promise<AdapterResult> {
    if (!sourceConfigured("crm")) return { slug: "crm", rollups: [], unconfigured: true };
    const sb = sourceClient("crm")!;
    const sevenDaysAgo = ymd(daysAgo(snapshotDate, 7));

    const { data: managers, error: mErr } = await sb
      .from("managers")
      .select("id, email, name, role, assigned_locations, active");
    if (mErr) return { slug: "crm", rollups: [], error: mErr.message };

    const lms = (managers ?? []).filter(
      (m: { role: string; active: boolean }) =>
        (m.role === "league_manager" || m.role === "district_manager") && m.active
    ) as Array<{ id: string; email: string; name: string; assigned_locations: string[] | null }>;

    const { data: locations } = await sb.from("locations").select("id, name");
    const locMap = new Map((locations ?? []).map((l: { id: string; name: string }) => [l.id, l.name]));

    // figure out the "current season" string the CRM team uses. Look at the most
    // recent goal row as the source of truth.
    const { data: latestGoal } = await sb
      .from("season_captain_goals")
      .select("season, updated_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const currentSeason = (latestGoal as { season?: string } | null)?.season ?? null;

    const ACTIVE_STATUSES = ["new", "contacted", "engaged", "hot", "closing"];

    const rollups: LMRollup[] = [];

    for (const m of lms) {
      const locIds = m.assigned_locations ?? [];
      const firstLoc = locIds[0];
      const rollup: LMRollup = {
        lm_email: m.email,
        location_name: firstLoc ? locMap.get(firstLoc) : undefined,
        metrics: [],
        action_items: [],
      };

      // 1. reg_pace — teams in their locations vs season target
      let goalTeams = 0;
      let currentTeams = 0;
      if (currentSeason && locIds.length) {
        const { data: goals } = await sb
          .from("season_captain_goals")
          .select("target, location_id")
          .eq("season", currentSeason)
          .in("location_id", locIds);
        goalTeams = (goals ?? []).reduce((s: number, g: { target: number }) => s + (g.target ?? 0), 0);

        const { count: regCount } = await sb
          .from("teams")
          .select("*", { count: "exact", head: true })
          .in("location_id", locIds)
          .eq("season", currentSeason)
          .in("status", ["registered", "full"]);
        currentTeams = regCount ?? 0;
      }
      const regPaceScore = goalTeams ? pctScore(currentTeams, goalTeams) : 100;
      rollup.metrics.push({
        metric_slug: "reg_pace",
        raw_value: currentTeams,
        max_score: 100,
        score: regPaceScore,
        payload: { goal: goalTeams, current: currentTeams, season: currentSeason },
      });
      if (regPaceScore < 70 && goalTeams > 0) {
        rollup.action_items.push({
          metric_slug: "reg_pace",
          title: `Registration behind: ${currentTeams}/${goalTeams} teams${currentSeason ? ` (${currentSeason})` : ""}`,
          detail: "Hit the captain pipeline today.",
          severity: regPaceScore < 40 ? "critical" : "high",
        });
      }

      // 2. lead_response_sla
      const { data: newLeads } = await sb
        .from("leads")
        .select("id, created_at")
        .eq("assigned_manager_id", m.id)
        .gte("created_at", sevenDaysAgo);
      const leadIds = (newLeads ?? []).map((l: { id: string }) => l.id);
      let withTouch = 0;
      if (leadIds.length) {
        const { data: outbound } = await sb
          .from("activities")
          .select("lead_id, created_at")
          .in("lead_id", leadIds)
          .eq("direction", "outbound");
        const firstByLead = new Map<string, Date>();
        for (const a of (outbound ?? []) as Array<{ lead_id: string; created_at: string }>) {
          const t = new Date(a.created_at);
          const prev = firstByLead.get(a.lead_id);
          if (!prev || t < prev) firstByLead.set(a.lead_id, t);
        }
        for (const lead of (newLeads ?? []) as Array<{ id: string; created_at: string }>) {
          const first = firstByLead.get(lead.id);
          if (first && first.getTime() - new Date(lead.created_at).getTime() <= 86400000) withTouch++;
        }
      }
      const slaScore = pctScore(withTouch, leadIds.length || 1);
      rollup.metrics.push({
        metric_slug: "lead_response_sla",
        raw_value: withTouch,
        max_score: 100,
        score: slaScore,
        payload: { window_days: 7, total: leadIds.length, on_time: withTouch },
      });
      if (slaScore < 80 && leadIds.length > 0) {
        rollup.action_items.push({
          metric_slug: "lead_response_sla",
          title: `${leadIds.length - withTouch} new leads waited > 24h for first touch`,
          severity: slaScore < 50 ? "high" : "medium",
        });
      }

      // 3. captain_followup
      const { data: activeLeads } = await sb
        .from("leads")
        .select("id")
        .eq("assigned_manager_id", m.id)
        .in("status", ACTIVE_STATUSES);
      const activeIds = (activeLeads ?? []).map((l: { id: string }) => l.id);
      let touchedRecently = 0;
      if (activeIds.length) {
        const { data: recent } = await sb
          .from("activities")
          .select("lead_id")
          .in("lead_id", activeIds)
          .gte("created_at", sevenDaysAgo);
        touchedRecently = new Set((recent ?? []).map((r: { lead_id: string }) => r.lead_id)).size;
      }
      const followupScore = pctScore(touchedRecently, activeIds.length || 1);
      rollup.metrics.push({
        metric_slug: "captain_followup",
        raw_value: touchedRecently,
        max_score: 100,
        score: followupScore,
        payload: { active: activeIds.length, touched_7d: touchedRecently },
      });
      if (followupScore < 75 && activeIds.length > 0) {
        rollup.action_items.push({
          metric_slug: "captain_followup",
          title: `${activeIds.length - touchedRecently} active captains haven't heard from you in 7+ days`,
          severity: "medium",
        });
      }

      rollups.push(rollup);
    }
    return { slug: "crm", rollups };
  },
};
