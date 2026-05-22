import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ymd } from "@/lib/source-apps/util";
import { scoreColor } from "@/lib/colors";

export default async function Leaderboard() {
  await requireUser();
  const sb = await createClient();
  const today = ymd(new Date());

  // RLS already filters to opted-in LMs (or admin sees all).
  const { data: rows } = await sb
    .from("lm_xp_totals")
    .select("lm_id, total_xp, max_xp, pct, rank_overall, league_managers!inner(full_name, location_name, district)")
    .eq("snapshot_date", today)
    .order("total_xp", { ascending: false })
    .limit(100);

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-3xl font-display font-bold">Leaderboard</h1>
        <p className="text-brodie-dim text-sm">Today&apos;s ranking. Opt out from My Day if you want off the board.</p>
      </header>

      <div className="rounded-xl border border-brodie-line overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-black/40 text-brodie-dim uppercase text-xs">
            <tr>
              <th className="text-left p-3">Rank</th>
              <th className="text-left p-3">LM</th>
              <th className="text-left p-3">Location</th>
              <th className="text-right p-3">XP</th>
              <th className="text-right p-3">%</th>
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
                league_managers: { full_name: string; location_name: string | null; district: string | null };
              };
              const pct = Math.round(row.pct);
              return (
                <tr key={row.lm_id} className="border-t border-brodie-line">
                  <td className="p-3 font-mono">{row.rank_overall ?? ""}</td>
                  <td className="p-3">{row.league_managers?.full_name ?? "—"}</td>
                  <td className="p-3 text-brodie-dim">{row.league_managers?.location_name ?? ""}{row.league_managers?.district ? ` · ${row.league_managers.district}` : ""}</td>
                  <td className="p-3 text-right">{Math.round(row.total_xp)} / {Math.round(row.max_xp)}</td>
                  <td className={`p-3 text-right font-semibold ${scoreColor(pct)}`}>{pct}%</td>
                </tr>
              );
            })}
            {(!rows || rows.length === 0) && (
              <tr><td colSpan={5} className="p-6 text-center text-brodie-dim">No scores yet today.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
