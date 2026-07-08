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

  // Pull any league-health profiles that have been promoted to super_admin.
  // We NEVER re-activate their league_managers row via sync — even if they
  // still show as league_manager in CRM (which we won't overwrite from
  // this app), they shouldn't reappear on the leaderboard/roster after
  // promotion.
  const { data: superAdmins } = await sb
    .from("profiles")
    .select("email")
    .eq("role", "super_admin");
  const superAdminEmails = new Set(
    ((superAdmins ?? []) as Array<{ email: string }>).map((p) => p.email.toLowerCase())
  );

  // DMs are admins, not LMs. They sign in to league-health, view their
  // LMs via /admin, but don't appear on the leaderboard themselves.
  const rows = all
    .filter((m) => m.role === "league_manager")
    .filter((m) => !superAdminEmails.has(m.email.toLowerCase()))
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

  // Force-deactivate any super_admin LMs still marked active from a previous
  // sync (belt and suspenders — the filter above stops NEW writes, this
  // catches existing rows).
  if (superAdminEmails.size > 0) {
    await sb
      .from("league_managers")
      .update({ active: false, updated_at: new Date().toISOString() })
      .in("email", Array.from(superAdminEmails))
      .eq("active", true);
  }

  // Auto-link profile_id for any LM whose email matches a logged-in profile.
  // This keeps "you logged in → you see your page" robust without anyone
  // having to manually wire the FK. Idempotent: only touches rows where
  // profile_id is still null.
  try {
    const { data: profiles } = await sb.from("profiles").select("id, email");
    const profileByEmail = new Map(
      ((profiles ?? []) as Array<{ id: string; email: string }>).map((p) => [
        p.email.toLowerCase(),
        p.id,
      ])
    );
    const { data: unlinked } = await sb
      .from("league_managers")
      .select("id, email")
      .is("profile_id", null);
    for (const lm of (unlinked ?? []) as Array<{ id: string; email: string }>) {
      const pid = profileByEmail.get(lm.email.toLowerCase());
      if (!pid) continue;
      await sb.from("league_managers").update({ profile_id: pid }).eq("id", lm.id);
    }
  } catch {
    // backfill is best-effort; never block the sync on it
  }

  return { synced: rows.length };
}
