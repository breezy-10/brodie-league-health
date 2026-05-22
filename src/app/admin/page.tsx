import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ymd, daysAgo } from "@/lib/source-apps/util";
import { scoreColor } from "@/lib/colors";
import { RefreshButton } from "@/components/RefreshButton";
import Link from "next/link";

export default async function AdminHome() {
  await requireRole(["dm", "super_admin"]);
  const sb = await createClient();
  const today = ymd(new Date());
  const yesterday = ymd(daysAgo(new Date(), 1));

  const { data: rows } = await sb
    .from("lm_xp_totals")
    .select("lm_id, total_xp, max_xp, pct, rank_overall, league_managers!inner(id, full_name, email, location_name, district, active)")
    .eq("snapshot_date", today)
    .order("total_xp", { ascending: false });

  const { data: prev } = await sb
    .from("lm_xp_totals")
    .select("lm_id, pct")
    .eq("snapshot_date", yesterday);
  const prevByLm = new Map((prev ?? []).map((p: { lm_id: string; pct: number }) => [p.lm_id, p.pct]));

  const { data: syncs } = await sb
    .from("sync_runs")
    .select("id, app_id, started_at, finished_at, status, rows_synced, error, apps!inner(slug, name)")
    .order("started_at", { ascending: false })
    .limit(14);

  return (
    <main className="space-y-8">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-display font-bold">Admin</h1>
          <p className="text-brodie-dim text-sm">All LMs, all scores, all knobs.</p>
        </div>
        <div className="flex gap-2">
          <RefreshButton />
          <Link href="/admin/weights" className="text-sm px-3 py-2 rounded border border-brodie-line hover:bg-brodie-line">Edit weights</Link>
          <Link href="/admin/setup" className="text-sm px-3 py-2 rounded border border-brodie-line hover:bg-brodie-line">Setup</Link>
        </div>
      </header>

      <section>
        <h2 className="text-lg font-display font-bold mb-3">All league managers — today</h2>
        <div className="rounded-xl border border-brodie-line overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-black/40 text-brodie-dim uppercase text-xs">
              <tr>
                <th className="text-left p-3">#</th>
                <th className="text-left p-3">LM</th>
                <th className="text-left p-3">Location</th>
                <th className="text-right p-3">XP</th>
                <th className="text-right p-3">%</th>
                <th className="text-right p-3">Δ vs yest.</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {(rows ?? []).map((r) => {
                const row = r as unknown as {
                  lm_id: string;
                  total_xp: number;
                  max_xp: number;
                  pct: number;
                  rank_overall: number;
                  league_managers: { id: string; full_name: string; email: string; location_name: string | null; district: string | null; active: boolean };
                };
                const pct = Math.round(row.pct);
                const prevPct = prevByLm.get(row.lm_id);
                const delta = prevPct != null ? Math.round(pct - prevPct) : null;
                return (
                  <tr key={row.lm_id} className="border-t border-brodie-line">
                    <td className="p-3 font-mono">{row.rank_overall ?? ""}</td>
                    <td className="p-3">
                      <Link href={`/admin/lm/${row.league_managers.id}`} className="hover:text-brodie-accent">
                        {row.league_managers.full_name}
                      </Link>
                      <p className="text-xs text-brodie-dim">{row.league_managers.email}</p>
                    </td>
                    <td className="p-3 text-brodie-dim">{row.league_managers.location_name}{row.league_managers.district ? ` · ${row.league_managers.district}` : ""}</td>
                    <td className="p-3 text-right">{Math.round(row.total_xp)} / {Math.round(row.max_xp)}</td>
                    <td className={`p-3 text-right font-semibold ${scoreColor(pct)}`}>{pct}%</td>
                    <td className="p-3 text-right text-xs">{delta == null ? "—" : delta > 0 ? <span className="text-brodie-good">+{delta}</span> : delta < 0 ? <span className="text-brodie-bad">{delta}</span> : "0"}</td>
                    <td className="p-3 text-right"><Link href={`/admin/lm/${row.league_managers.id}`} className="text-brodie-accent text-xs">View →</Link></td>
                  </tr>
                );
              })}
              {(!rows || rows.length === 0) && (
                <tr><td colSpan={7} className="p-6 text-center text-brodie-dim">No data yet today. Hit Refresh.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-display font-bold mb-3">Sync health</h2>
        <div className="rounded-xl border border-brodie-line overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-black/40 text-brodie-dim uppercase text-xs">
              <tr>
                <th className="text-left p-3">App</th>
                <th className="text-left p-3">Started</th>
                <th className="text-left p-3">Status</th>
                <th className="text-right p-3">Rows</th>
                <th className="text-left p-3">Error</th>
              </tr>
            </thead>
            <tbody>
              {(syncs ?? []).map((s) => {
                const row = s as unknown as { id: string; started_at: string; status: string; rows_synced: number | null; error: string | null; apps: { name: string } };
                const color =
                  row.status === "success" ? "text-brodie-good" :
                  row.status === "error"   ? "text-brodie-bad"  :
                  row.status === "partial" ? "text-brodie-warn" : "text-brodie-dim";
                return (
                  <tr key={row.id} className="border-t border-brodie-line">
                    <td className="p-3">{row.apps?.name}</td>
                    <td className="p-3 text-brodie-dim font-mono text-xs">{row.started_at.replace("T", " ").slice(0, 16)}</td>
                    <td className={`p-3 ${color}`}>{row.status}</td>
                    <td className="p-3 text-right">{row.rows_synced ?? "—"}</td>
                    <td className="p-3 text-brodie-bad text-xs truncate max-w-xs">{row.error}</td>
                  </tr>
                );
              })}
              {(!syncs || syncs.length === 0) && (
                <tr><td colSpan={5} className="p-6 text-center text-brodie-dim">No sync runs yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
