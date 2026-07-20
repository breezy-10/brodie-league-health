import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { RefreshButton } from "@/components/RefreshButton";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminSync() {
  await requireRole(["super_admin"]);
  const sb = await createClient();

  const { data: syncs } = await sb
    .from("sync_runs")
    .select("id, app_id, started_at, finished_at, status, rows_synced, error, apps!inner(slug, name)")
    .order("started_at", { ascending: false })
    .limit(30);

  return (
    <main className="space-y-6 brodie-fade-in">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] mb-1" style={{ color: "var(--glass-gold)" }}>Settings</p>
          <h1 className="text-3xl font-semibold tracking-tight">Sync &amp; refresh</h1>
          <p className="text-glass-text-secondary text-sm mt-1">Re-run every adapter and re-score all LMs, then review the last runs.</p>
        </div>
        <RefreshButton />
      </header>

      <section>
        <div className="rounded-2xl border border-glass-border bg-glass-surface overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-glass-surface-hover text-glass-text-tertiary uppercase text-[10px] tracking-wider">
              <tr>
                <th className="text-left p-3 font-semibold">App</th>
                <th className="text-left p-3 font-semibold">Started</th>
                <th className="text-left p-3 font-semibold">Status</th>
                <th className="text-right p-3 font-semibold">Rows</th>
                <th className="text-left p-3 font-semibold">Error</th>
              </tr>
            </thead>
            <tbody>
              {(syncs ?? []).map((s) => {
                const row = s as unknown as { id: string; started_at: string; status: string; rows_synced: number | null; error: string | null; apps: { name: string } };
                const color =
                  row.status === "success" ? "text-green-400" :
                  row.status === "error"   ? "text-red-400"   :
                  row.status === "partial" ? "text-yellow-400" : "text-glass-text-tertiary";
                return (
                  <tr key={row.id} className="border-t border-glass-border-light">
                    <td className="p-3">{row.apps?.name}</td>
                    <td className="p-3 text-glass-text-tertiary font-mono text-xs">{row.started_at.replace("T", " ").slice(0, 16)}</td>
                    <td className={`p-3 ${color}`}>{row.status}</td>
                    <td className="p-3 text-right">{row.rows_synced ?? "—"}</td>
                    <td className="p-3 text-red-400 text-xs truncate max-w-xs">{row.error}</td>
                  </tr>
                );
              })}
              {(!syncs || syncs.length === 0) && (
                <tr><td colSpan={5} className="p-6 text-center text-glass-text-tertiary">No sync runs yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
