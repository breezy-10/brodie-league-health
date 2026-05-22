import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ymd, daysAgo } from "@/lib/source-apps/util";
import { scoreColor, scoreBg } from "@/lib/colors";
import Link from "next/link";

export default async function LMDrill({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["dm", "super_admin"]);
  const { id } = await params;
  const sb = await createClient();
  const today = ymd(new Date());
  const fourteenAgo = ymd(daysAgo(new Date(), 14));

  const { data: lm } = await sb
    .from("league_managers")
    .select("id, full_name, email, location_name, district")
    .eq("id", id)
    .maybeSingle();
  if (!lm) return <p className="text-brodie-dim p-6">LM not found.</p>;

  const { data: xp } = await sb
    .from("lm_xp_totals")
    .select("total_xp, max_xp, pct, rank_overall, breakdown, snapshot_date")
    .eq("lm_id", id)
    .gte("snapshot_date", fourteenAgo)
    .order("snapshot_date", { ascending: false });

  const today_xp = (xp ?? []).find((x: { snapshot_date: string }) => x.snapshot_date === today) as { total_xp: number; max_xp: number; pct: number; rank_overall: number; breakdown: Record<string, { score: number; max: number; metrics: Record<string, { score: number; max: number }> }> } | undefined;

  const { data: snapshots } = await sb
    .from("daily_snapshots")
    .select("score, max_score, raw_value, raw_payload, metrics!inner(slug, name, app_id), apps:metrics(app_id)")
    .eq("lm_id", id)
    .eq("snapshot_date", today);

  const { data: actions } = await sb
    .from("daily_action_items")
    .select("id, title, detail, severity, resolved_at, apps!inner(name)")
    .eq("lm_id", id)
    .eq("snapshot_date", today)
    .order("severity", { ascending: true });

  const lmRow = lm as { full_name: string; email: string; location_name: string | null; district: string | null };
  const pct = Math.round(today_xp?.pct ?? 0);

  return (
    <main className="space-y-6">
      <Link href="/admin" className="text-xs text-brodie-dim hover:text-white">&larr; Back to admin</Link>
      <header>
        <h1 className="text-3xl font-display font-bold">{lmRow.full_name}</h1>
        <p className="text-brodie-dim text-sm">{lmRow.email} · {lmRow.location_name ?? "—"}{lmRow.district ? ` · ${lmRow.district}` : ""}</p>
      </header>

      {today_xp && (
        <section className={`rounded-2xl border p-6 ${scoreBg(pct)}`}>
          <p className="uppercase text-xs text-brodie-dim tracking-wider">Today</p>
          <p className={`text-5xl font-display font-bold ${scoreColor(pct)}`}>{Math.round(today_xp.total_xp)}<span className="text-brodie-dim text-xl"> / {Math.round(today_xp.max_xp)}</span></p>
          <p className="text-brodie-dim text-sm">{pct}% · rank #{today_xp.rank_overall ?? "—"}</p>
        </section>
      )}

      <section>
        <h2 className="text-lg font-display font-bold mb-3">Metrics — today</h2>
        <div className="rounded-xl border border-brodie-line overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-black/40 text-brodie-dim uppercase text-xs">
              <tr>
                <th className="text-left p-3">Metric</th>
                <th className="text-right p-3">Raw</th>
                <th className="text-right p-3">Score</th>
              </tr>
            </thead>
            <tbody>
              {(snapshots ?? []).map((s, i) => {
                const row = s as unknown as { score: number; max_score: number; raw_value: number; metrics: { name: string; slug: string } };
                const p = Math.round((row.score / Math.max(row.max_score, 1)) * 100);
                return (
                  <tr key={i} className="border-t border-brodie-line">
                    <td className="p-3">{row.metrics?.name ?? ""}</td>
                    <td className="p-3 text-right text-brodie-dim">{row.raw_value}</td>
                    <td className={`p-3 text-right ${scoreColor(p)}`}>{Math.round(row.score)} / {row.max_score}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-display font-bold mb-3">Action items</h2>
        <ul className="space-y-2">
          {(actions ?? []).map((a) => {
            const item = a as unknown as { id: string; title: string; detail: string | null; severity: string; resolved_at: string | null; apps: { name: string } };
            return (
              <li key={item.id} className={`rounded-lg border border-brodie-line p-3 ${item.resolved_at ? "opacity-50" : ""}`}>
                <p className="text-sm">{item.title}</p>
                {item.detail && <p className="text-xs text-brodie-dim">{item.detail}</p>}
                <p className="text-[10px] uppercase tracking-wider text-brodie-dim mt-1">{item.apps?.name} · {item.severity}</p>
              </li>
            );
          })}
          {(!actions || actions.length === 0) && <li className="text-brodie-dim">No open action items.</li>}
        </ul>
      </section>
    </main>
  );
}
