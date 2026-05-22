import { createAdminClient } from "@/lib/supabase/admin";
import { sourceClient, sourceConfigured } from "@/lib/source-apps/clients";

/**
 * Pull the canonical LM roster from brodie-crm.managers and upsert into
 * league_managers. Email is the cross-app join key.
 *
 * brodie-crm.managers schema (verified):
 *   id, auth_user_id, email, name, role (enum: super_admin | district_manager |
 *   league_manager), assigned_locations text[] (location.id text array),
 *   reports_to (manager_id), active.
 *
 * We treat 'league_manager' and 'district_manager' as scorable LMs. We pick
 * the first assigned location as their location_name. The DM's name (via
 * reports_to) becomes our `district` field.
 */
export async function syncRoster(): Promise<{ synced: number; error?: string }> {
  if (!sourceConfigured("crm")) return { synced: 0, error: "CRM not configured" };
  const crm = sourceClient("crm")!;
  const sb = createAdminClient();

  const { data: managers, error } = await crm
    .from("managers")
    .select("id, email, name, role, assigned_locations, reports_to, active");
  if (error) return { synced: 0, error: error.message };

  const { data: locs } = await crm.from("locations").select("id, name");
  const locMap = new Map((locs ?? []).map((l: { id: string; name: string }) => [l.id, l.name]));

  type CrmManager = {
    id: string;
    email: string;
    name: string;
    role: string;
    assigned_locations: string[] | null;
    reports_to: string | null;
    active: boolean;
  };

  const all = (managers ?? []) as CrmManager[];
  const byId = new Map(all.map((m) => [m.id, m]));

  const rows = all
    .filter((m) => m.role === "league_manager" || m.role === "district_manager")
    .map((m) => {
      const firstLoc = (m.assigned_locations ?? [])[0];
      const dm = m.reports_to ? byId.get(m.reports_to) : undefined;
      return {
        email: m.email.toLowerCase(),
        full_name: m.name,
        location_name: firstLoc ? locMap.get(firstLoc) ?? firstLoc : null,
        district: dm?.name ?? null,
        active: m.active ?? true,
        updated_at: new Date().toISOString(),
      };
    });

  if (!rows.length) return { synced: 0 };

  const { error: upErr } = await sb.from("league_managers").upsert(rows, { onConflict: "email" });
  if (upErr) return { synced: 0, error: upErr.message };
  return { synced: rows.length };
}
