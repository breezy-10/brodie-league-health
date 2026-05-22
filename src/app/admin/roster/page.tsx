import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { RosterImporter } from "@/components/RosterImporter";

export default async function RosterPage() {
  await requireRole(["dm", "super_admin"]);
  const sb = await createClient();
  const { data: rows } = await sb
    .from("league_managers")
    .select("email, full_name, location_name, district, slack_user_id, active")
    .order("full_name", { ascending: true });

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-3xl font-display font-bold">Roster</h1>
        <p className="text-brodie-dim text-sm">
          League managers known to league-health. Synced nightly from brodie-crm.
          You can also bulk-upsert via CSV below (header row required).
        </p>
      </header>

      <RosterImporter />

      <div className="rounded-xl border border-brodie-line overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-black/40 text-brodie-dim uppercase text-xs">
            <tr>
              <th className="text-left p-3">Name</th>
              <th className="text-left p-3">Email</th>
              <th className="text-left p-3">Location</th>
              <th className="text-left p-3">District</th>
              <th className="text-left p-3">Slack</th>
              <th className="text-left p-3">Active</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((r) => {
              const row = r as { email: string; full_name: string | null; location_name: string | null; district: string | null; slack_user_id: string | null; active: boolean };
              return (
                <tr key={row.email} className="border-t border-brodie-line">
                  <td className="p-3">{row.full_name ?? "—"}</td>
                  <td className="p-3 text-brodie-dim font-mono text-xs">{row.email}</td>
                  <td className="p-3 text-brodie-dim">{row.location_name ?? ""}</td>
                  <td className="p-3 text-brodie-dim">{row.district ?? ""}</td>
                  <td className="p-3 text-brodie-dim font-mono text-xs">{row.slack_user_id ?? "—"}</td>
                  <td className="p-3">{row.active ? "✓" : "—"}</td>
                </tr>
              );
            })}
            {(!rows || rows.length === 0) && (
              <tr><td colSpan={6} className="p-6 text-center text-brodie-dim">No LMs yet. Run a sync or paste a CSV above.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
