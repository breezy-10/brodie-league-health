/**
 * District composition lookup. Given a DM's email, returns the LMs that
 * report to them (per CRM managers.reports_to). Falls back to the global
 * roster for super_admins so the page is always useful.
 */
import { sourceClient, sourceConfigured } from "@/lib/source-apps/clients";
import { createAdminClient } from "@/lib/supabase/admin";

export type DistrictLM = {
  id: string;          // league_managers.id (our DB)
  email: string;
  name: string;
  location_name: string | null;
  today_xp: number | null;
  today_pct: number | null;
  avg_30d: number | null;
  current_streak: number | null;
  tier: string | null;
  open_critical_count: number;
  rank_overall: number | null;
};

export async function loadDistrict(
  dmEmail: string,
  todayStr: string,
  showAll: boolean = false
): Promise<{ lms: DistrictLM[]; dmName: string | null }> {
  let lmEmails: string[] | null = null;
  let dmName: string | null = null;

  // Pull the LMs from CRM that have the DM as their reports_to (if we can).
  if (sourceConfigured("crm") && !showAll) {
    const crm = sourceClient("crm")!;
    const { data: dm } = await crm
      .from("managers")
      .select("id, name")
      .eq("email", dmEmail.toLowerCase())
      .maybeSingle();
    if (dm) {
      const dmRow = dm as { id: string; name: string };
      dmName = dmRow.name;
      const { data: reports } = await crm
        .from("managers")
        .select("email")
        .eq("reports_to", dmRow.id)
        .eq("role", "league_manager")
        .eq("active", true);
      lmEmails = ((reports ?? []) as Array<{ email: string }>).map((r) => r.email.toLowerCase());
    }
  }

  // Build the district view from our own DB
  const sb = createAdminClient();
  let query = sb
    .from("league_managers")
    .select(`
      id, email, full_name, location_name, current_streak, tier, avg_30d
    `)
    .eq("active", true);
  if (lmEmails && lmEmails.length > 0) {
    query = query.in("email", lmEmails);
  }
  const { data: lmRows } = await query;
  const lms = (lmRows ?? []) as Array<{
    id: string; email: string; full_name: string; location_name: string | null;
    current_streak: number | null; tier: string | null; avg_30d: number | null;
  }>;
  if (!lms.length) return { lms: [], dmName };

  // Pull today's totals + open action counts in parallel
  const lmIds = lms.map((l) => l.id);
  const [{ data: xpRows }, { data: actions }] = await Promise.all([
    sb
      .from("lm_xp_totals")
      .select("lm_id, total_xp, pct, rank_overall")
      .in("lm_id", lmIds)
      .eq("snapshot_date", todayStr),
    sb
      .from("daily_action_items")
      .select("lm_id, severity, resolved_at")
      .in("lm_id", lmIds)
      .eq("snapshot_date", todayStr),
  ]);

  const xpByLm = new Map(((xpRows ?? []) as Array<{ lm_id: string; total_xp: number; pct: number; rank_overall: number | null }>).map((x) => [x.lm_id, x]));
  const criticalByLm = new Map<string, number>();
  for (const a of (actions ?? []) as Array<{ lm_id: string; severity: string; resolved_at: string | null }>) {
    if (a.resolved_at) continue;
    if (a.severity === "critical" || a.severity === "high") {
      criticalByLm.set(a.lm_id, (criticalByLm.get(a.lm_id) ?? 0) + 1);
    }
  }

  return {
    dmName,
    lms: lms
      .map((lm) => {
        const xp = xpByLm.get(lm.id);
        return {
          id: lm.id,
          email: lm.email,
          name: lm.full_name,
          location_name: lm.location_name,
          today_xp: xp?.total_xp != null ? Number(xp.total_xp) : null,
          today_pct: xp?.pct != null ? Number(xp.pct) : null,
          avg_30d: lm.avg_30d != null ? Number(lm.avg_30d) : null,
          current_streak: lm.current_streak ?? null,
          tier: lm.tier ?? null,
          open_critical_count: criticalByLm.get(lm.id) ?? 0,
          rank_overall: xp?.rank_overall ?? null,
        };
      })
      .sort((a, b) => (b.today_xp ?? -9999) - (a.today_xp ?? -9999)),
  };
}
