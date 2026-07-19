import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ymd, daysAgo } from "@/lib/source-apps/util";
import { scoreColor } from "@/lib/colors";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminLMs() {
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

  return (
    <main className="space-y-6 brodie-fade-in">
      <header>
        <p className="font-mono text-xs uppercase tracking-[0.18em] mb-1" style={{ color: "var(--glass-gold)" }}>Settings</p>
        <h1 className="text-3xl font-semibold tracking-tight">League managers</h1>
        <p className="text-glass-text-secondary text-sm mt-1">Every LM&apos;s score today, ranked, with the day-over-day delta.</p>
      </header>

      <section>
        <div className="rounded-2xl border border-glass-border bg-glass-surface overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-glass-surface-hover text-glass-text-tertiary uppercase text-[10px] tracking-wider">
              <tr>
                <th className="text-left p-3 font-semibold">#</th>
                <th className="text-left p-3 font-semibold">LM</th>
                <th className="text-left p-3 font-semibold">Location</th>
                <th className="text-right p-3 font-semibold">XP</th>
                <th className="text-right p-3 font-semibold">%</th>
                <th className="text-right p-3 font-semibold">Δ vs yest.</th>
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
                  <tr key={row.lm_id} className="border-t border-glass-border-light hover:bg-glass-surface-hover">
                    <td className="p-3 font-mono text-glass-text-secondary">{row.rank_overall ?? ""}</td>
                    <td className="p-3">
                      <Link href={`/?lm=${row.league_managers.id}`} className="hover:text-glass-gold">
                        {row.league_managers.full_name}
                      </Link>
                      <p className="text-xs text-glass-text-tertiary mt-0.5">{row.league_managers.email}</p>
                    </td>
                    <td className="p-3 text-glass-text-secondary">
                      {row.league_managers.location_name}
                      {row.league_managers.district ? ` · ${row.league_managers.district}` : ""}
                    </td>
                    <td className="p-3 text-right">{Math.round(row.total_xp)} / {Math.round(row.max_xp)}</td>
                    <td className={`p-3 text-right font-semibold ${scoreColor(pct)}`}>{pct}%</td>
                    <td className="p-3 text-right text-xs">
                      {delta == null ? "—" : delta > 0 ? <span className="text-green-400">+{delta}</span> : delta < 0 ? <span className="text-red-400">{delta}</span> : "0"}
                    </td>
                    <td className="p-3 text-right space-x-3">
                      <Link href={`/?lm=${row.league_managers.id}`} className="text-glass-gold text-xs">View day →</Link>
                      <Link href={`/settings/lm/${row.league_managers.id}`} className="text-xs text-glass-text-tertiary hover:text-glass-text">Metrics</Link>
                    </td>
                  </tr>
                );
              })}
              {(!rows || rows.length === 0) && (
                <tr><td colSpan={7} className="p-6 text-center text-glass-text-tertiary">No data yet today. Refresh from Sync &amp; refresh.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
