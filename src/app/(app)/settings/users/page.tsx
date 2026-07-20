import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import UsersTable, { type UserListRow } from "./UsersTable";
import { ROLE_ORDER, type UserRole, type UserStatus } from "./roles";
import { getAssignableLocations } from "@/lib/locations";

// Live access state — never cache.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminUsersPage() {
  const { user, profile } = await requireRole(["dm", "operations_manager", "super_admin"]);
  const isSuperAdmin = profile?.role === "super_admin";
  const admin = createAdminClient();

  const [{ data: profiles }, authList, { data: managers }, { data: userLocs }, assignableLocations] = await Promise.all([
    admin.from("profiles").select("id, email, full_name, role").order("full_name"),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    admin.from("league_managers").select("email, location_name"),
    admin.from("user_locations").select("user_id, location_name"),
    getAssignableLocations(),
  ]);

  // Assigned locations per user (the new source of truth for user -> location).
  const locsByUser = new Map<string, string[]>();
  for (const r of (userLocs ?? []) as { user_id: string; location_name: string }[]) {
    const arr = locsByUser.get(r.user_id) ?? [];
    arr.push(r.location_name);
    locsByUser.set(r.user_id, arr);
  }

  // auth.users carries the lifecycle signals we don't store on profiles:
  // never-signed-in ⇒ invited, banned ⇒ archived.
  type AuthUser = { id: string; last_sign_in_at?: string | null; banned_until?: string | null };
  const authById = new Map<string, AuthUser>(
    (authList.data?.users ?? []).map((u) => [u.id, u as unknown as AuthUser]),
  );
  const locByEmail = new Map(
    (managers ?? []).map((m: { email: string; location_name: string | null }) => [m.email.toLowerCase(), m.location_name]),
  );

  const now = Date.now();
  const rows: UserListRow[] = ((profiles ?? []) as Array<{ id: string; email: string; full_name: string | null; role: UserRole }>)
    .map((p) => {
      const au = authById.get(p.id);
      const banned = au?.banned_until ? new Date(au.banned_until).getTime() > now : false;
      const neverSignedIn = !au?.last_sign_in_at;
      const status: UserStatus = banned ? "inactive" : neverSignedIn ? "invited" : "active";
      return {
        id: p.id,
        email: p.email,
        fullName: p.full_name || p.email,
        role: p.role,
        status,
        location: locByEmail.get(p.email.toLowerCase()) ?? null,
        locations: (locsByUser.get(p.id) ?? []).sort((a, b) => a.localeCompare(b)),
      };
    })
    .sort((a, b) => {
      const r = ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role);
      return r !== 0 ? r : a.fullName.localeCompare(b.fullName);
    });

  const locations = Array.from(
    new Set(rows.flatMap((r) => [r.location, ...r.locations]).filter((l): l is string => !!l)),
  ).sort((a, b) => a.localeCompare(b));

  return (
    <main className="brodie-fade-in space-y-6">
      <div>
        <Link href={isSuperAdmin ? "/settings" : "/dashboard"} className="text-sm text-glass-text-tertiary hover:text-glass-text transition">
          {isSuperAdmin ? "← Back to settings" : "← Back to dashboard"}
        </Link>
        <p className="font-mono text-xs uppercase tracking-[0.18em] mt-3 mb-1" style={{ color: "var(--glass-gold)" }}>{isSuperAdmin ? "Settings" : "Admin"}</p>
        <h1 className="text-3xl font-semibold tracking-tight" style={{ color: "var(--glass-text)" }}>Users</h1>
        <p className="text-sm mt-1 text-glass-text-secondary">
          Invite staff and manage roles &amp; access. Anyone can be invited — they don&apos;t need to be in the CRM.
        </p>
      </div>
      <UsersTable meId={user.id} rows={rows} locations={locations} allLocations={assignableLocations} />
    </main>
  );
}
