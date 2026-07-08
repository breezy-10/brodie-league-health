import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// Force dynamic so the roster reflects live DB state, not a stale render.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function RosterPage() {
  await requireRole(["dm", "super_admin"]);
  // Admin client bypasses RLS quirks — the requireRole gate above already
  // ensures only DMs/super_admins reach this page. Every LM should always
  // be visible here regardless of active status.
  const sb = createAdminClient();
  const { data: rows } = await sb
    .from("league_managers")
    .select("email, full_name, location_name, district, slack_user_id, active")
    .order("full_name", { ascending: true });

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Roster</h1>
        <p className="text-glass-text-secondary text-sm mt-1">
          Pulled from <span className="font-mono">brodie-crm.managers</span> every sync. Edit a row in the CRM and it propagates here on the next refresh.
        </p>
      </header>

      <div className="rounded-2xl border border-glass-border bg-glass-surface overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-glass-surface-hover text-glass-text-tertiary uppercase text-[10px] tracking-wider">
            <tr>
              <th className="text-left p-3 font-semibold">Name</th>
              <th className="text-left p-3 font-semibold">Email</th>
              <th className="text-left p-3 font-semibold">Location</th>
              <th className="text-left p-3 font-semibold">District</th>
              <th className="text-left p-3 font-semibold">Slack</th>
              <th className="text-left p-3 font-semibold">Active</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((r) => {
              const row = r as { email: string; full_name: string | null; location_name: string | null; district: string | null; slack_user_id: string | null; active: boolean };
              return (
                <tr key={row.email} className="border-t border-glass-border-light">
                  <td className="p-3">{row.full_name ?? "—"}</td>
                  <td className="p-3 text-glass-text-tertiary font-mono text-xs">{row.email}</td>
                  <td className="p-3 text-glass-text-secondary">{row.location_name ?? ""}</td>
                  <td className="p-3 text-glass-text-secondary">{row.district ?? ""}</td>
                  <td className="p-3 text-glass-text-tertiary font-mono text-xs">{row.slack_user_id ?? "—"}</td>
                  <td className="p-3">{row.active ? "✓" : "—"}</td>
                </tr>
              );
            })}
            {(!rows || rows.length === 0) && (
              <tr><td colSpan={6} className="p-6 text-center text-glass-text-tertiary">No LMs yet. Hit Refresh on the admin page to sync from CRM.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
