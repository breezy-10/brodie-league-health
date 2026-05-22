import type { Adapter, AdapterResult, LMRollup } from "../types";
import { sourceClient, sourceConfigured } from "../clients";

/**
 * brodie-training-pilot verified schema:
 *   users: id, email, full_name, location_id (single primary location),
 *          primary_role_id, status (active|inactive|invited)
 *   roles: id, slug, name
 *   user_roles: user_id, role_id (many-to-many secondary)
 *   modules: id, slug, title
 *   module_assignments: user_id, module_id, due_at, assigned_at
 *   completions: user_id, module_id, passed_at, expires_at
 *   locations: id, name
 *   user_locations: user_id, location_id (added in 0011, multi-location coverage)
 *
 * LMs identified via roles.slug = 'league_manager' (or 'lm'). Each LM's
 * primary location is users.location_id. We score them on the staff in that
 * same location (active users whose location_id matches).
 *
 * Sub-metrics:
 *   cert_current      (70%) — % of active staff in location with all assigned
 *                              modules completed AND not expired
 *   module_completion (30%) — % of assigned modules across all those staff
 *                              that are completed AND not expired
 */
export const trainingAdapter: Adapter = {
  slug: "training",
  async sync(snapshotDate: Date): Promise<AdapterResult> {
    if (!sourceConfigured("training")) return { slug: "training", rollups: [], unconfigured: true };
    const sb = sourceClient("training")!;
    const nowIso = snapshotDate.toISOString();

    const { data: roles } = await sb.from("roles").select("id, slug, name");
    const lmRoleIds = new Set(
      (roles ?? [])
        .filter((r: { slug?: string; name?: string }) => {
          const tag = (r.slug ?? r.name ?? "").toLowerCase();
          return ["lm", "league_manager", "dm", "district_manager"].includes(tag);
        })
        .map((r: { id: string }) => r.id)
    );

    const { data: users, error: uErr } = await sb
      .from("users")
      .select("id, email, full_name, location_id, primary_role_id, status");
    if (uErr) return { slug: "training", rollups: [], error: uErr.message };

    const { data: userRoles } = await sb.from("user_roles").select("user_id, role_id");

    const lmUserIds = new Set<string>();
    for (const u of (users ?? []) as Array<{ id: string; primary_role_id: string | null }>) {
      if (u.primary_role_id && lmRoleIds.has(u.primary_role_id)) lmUserIds.add(u.id);
    }
    for (const ur of (userRoles ?? []) as Array<{ user_id: string; role_id: string }>) {
      if (lmRoleIds.has(ur.role_id)) lmUserIds.add(ur.user_id);
    }

    const lms = (users ?? []).filter(
      (u: { id: string; status: string }) => lmUserIds.has(u.id) && u.status === "active"
    ) as Array<{ id: string; email: string; full_name: string; location_id: string | null }>;

    const { data: locations } = await sb.from("locations").select("id, name");
    const locMap = new Map((locations ?? []).map((l: { id: string; name: string }) => [l.id, l.name]));

    // Pre-aggregate assignments + completions per user
    const { data: assignments } = await sb.from("module_assignments").select("user_id, module_id");
    const { data: completions } = await sb.from("completions").select("user_id, module_id, passed_at, expires_at");

    const assignByUser = new Map<string, Set<string>>();
    for (const a of (assignments ?? []) as Array<{ user_id: string; module_id: string }>) {
      if (!assignByUser.has(a.user_id)) assignByUser.set(a.user_id, new Set());
      assignByUser.get(a.user_id)!.add(a.module_id);
    }
    const doneByUser = new Map<string, Set<string>>();
    for (const c of (completions ?? []) as Array<{ user_id: string; module_id: string; passed_at: string | null; expires_at: string | null }>) {
      if (!c.passed_at) continue;
      if (c.expires_at && c.expires_at < nowIso) continue;
      if (!doneByUser.has(c.user_id)) doneByUser.set(c.user_id, new Set());
      doneByUser.get(c.user_id)!.add(c.module_id);
    }

    // staff per location
    const staffByLoc = new Map<string, Array<{ id: string }>>();
    for (const u of (users ?? []) as Array<{ id: string; location_id: string | null; status: string }>) {
      if (u.status !== "active") continue;
      if (!u.location_id) continue;
      if (!staffByLoc.has(u.location_id)) staffByLoc.set(u.location_id, []);
      staffByLoc.get(u.location_id)!.push({ id: u.id });
    }

    const rollups: LMRollup[] = [];
    for (const lm of lms) {
      const staff = lm.location_id ? staffByLoc.get(lm.location_id) ?? [] : [];

      let totalStaff = staff.length;
      let fullyCertified = 0;
      let assignSum = 0;
      let doneSum = 0;
      for (const s of staff) {
        const a = assignByUser.get(s.id)?.size ?? 0;
        const d = doneByUser.get(s.id)?.size ?? 0;
        if (a > 0) {
          assignSum += a;
          doneSum += Math.min(d, a);
          if (d >= a) fullyCertified++;
        } else {
          // no assignments = trivially "current"
          fullyCertified++;
        }
      }
      const certPct = totalStaff ? Math.round((fullyCertified / totalStaff) * 100) : 100;
      const compPct = assignSum ? Math.round((doneSum / assignSum) * 100) : 100;

      const rollup: LMRollup = {
        lm_email: lm.email,
        location_name: lm.location_id ? locMap.get(lm.location_id) : undefined,
        metrics: [
          { metric_slug: "cert_current",      raw_value: certPct, max_score: 100, score: certPct, payload: { total: totalStaff, fully_done: fullyCertified } },
          { metric_slug: "module_completion", raw_value: compPct, max_score: 100, score: compPct, payload: { assigned: assignSum, completed: doneSum } },
        ],
        action_items: [],
      };
      if (certPct < 80 && totalStaff > 0) {
        rollup.action_items.push({
          metric_slug: "cert_current",
          title: `${totalStaff - fullyCertified} of your ${totalStaff} staff aren't fully certified`,
          severity: certPct < 60 ? "high" : "medium",
        });
      }
      rollups.push(rollup);
    }
    return { slug: "training", rollups };
  },
};
