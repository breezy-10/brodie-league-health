import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ymd, daysAgo } from "@/lib/source-apps/util";
import { scoreColor, scoreBg, severityDot } from "@/lib/colors";
import Link from "next/link";

export default async function LMDrill({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["super_admin"]);
  const { id } = await params;
  const sb = await createClient();
  const today = ymd(new Date());
  const fourteenAgo = ymd(daysAgo(new Date(), 14));

  const { data: lm } = await sb
    .from("league_managers")
    .select("id, full_name, email, location_name, district")
    .eq("id", id)
    .maybeSingle();
  if (!lm) return <p className="text-glass-text-tertiary p-6">LM not found.</p>;

  const { data: xp } = await sb
    .from("lm_xp_totals")
    .select("total_xp, max_xp, pct, rank_overall, breakdown, snapshot_date")
    .eq("lm_id", id)
    .gte("snapshot_date", fourteenAgo)
    .order("snapshot_date", { ascending: false });

  const today_xp = (xp ?? []).find((x: { snapshot_date: string }) => x.snapshot_date === today) as { total_xp: number; max_xp: number; pct: number; rank_overall: number } | undefined;

  const { data: snapshots } = await sb
    .from("daily_snapshots")
    .select("score, max_score, raw_value, raw_payload, metrics!inner(slug, name, app_id)")
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
      <Link href="/settings" className="text-xs text-glass-text-tertiary hover:text-glass-text">&larr; Back to settings</Link>
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{lmRow.full_name}</h1>
          <p className="text-glass-text-secondary text-sm mt-1">
            {lmRow.email} · {lmRow.location_name ?? "—"}{lmRow.district ? ` · ${lmRow.district}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/settings/lm/${id}/monthly`}
            className="text-xs px-3 py-1.5 rounded-full font-semibold"
            style={{
              background: "var(--accent-soft)",
              color: "var(--accent)",
              border: "1px solid rgba(242, 169, 0, 0.5)",
            }}
          >
            Monthly review →
          </Link>
          <Link
            href={`/district/prep/${id}`}
            className="text-xs px-3 py-1.5 rounded-full font-semibold"
            style={{
              background: "var(--bg-raised)",
              color: "var(--text)",
              border: "1px solid var(--border)",
            }}
          >
            1:1 prep →
          </Link>
        </div>
      </header>

      {today_xp && (
        <section className={`rounded-2xl border p-6 ${scoreBg(pct)}`}>
          <p className="uppercase text-[11px] text-glass-text-tertiary tracking-[0.08em] font-semibold">Today</p>
          <p className={`text-5xl font-semibold tracking-tight ${scoreColor(pct)}`}>
            {Math.round(today_xp.total_xp)}<span className="text-glass-text-tertiary text-xl"> / {Math.round(today_xp.max_xp)}</span>
          </p>
          <p className="text-glass-text-secondary text-sm mt-1">{pct}% · rank #{today_xp.rank_overall ?? "—"}</p>
        </section>
      )}

      <section>
        <h2 className="text-base font-semibold mb-3">Metrics — today</h2>
        <div className="rounded-2xl border border-glass-border bg-glass-surface overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-glass-surface-hover text-glass-text-tertiary uppercase text-[10px] tracking-wider">
              <tr>
                <th className="text-left p-3 font-semibold">Metric</th>
                <th className="text-right p-3 font-semibold">Raw</th>
                <th className="text-right p-3 font-semibold">Score</th>
              </tr>
            </thead>
            <tbody>
              {(snapshots ?? []).map((s, i) => {
                const row = s as unknown as { score: number; max_score: number; raw_value: number; metrics: { name: string; slug: string } };
                const p = Math.round((row.score / Math.max(row.max_score, 1)) * 100);
                return (
                  <tr key={i} className="border-t border-glass-border-light">
                    <td className="p-3">{row.metrics?.name ?? ""}</td>
                    <td className="p-3 text-right text-glass-text-tertiary">{row.raw_value}</td>
                    <td className={`p-3 text-right ${scoreColor(p)}`}>{Math.round(row.score)} / {row.max_score}</td>
                  </tr>
                );
              })}
              {(!snapshots || snapshots.length === 0) && (
                <tr><td colSpan={3} className="p-6 text-center text-glass-text-tertiary">No data yet today.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-base font-semibold mb-3">Action items</h2>
        <ul className="space-y-2">
          {(actions ?? []).map((a) => {
            const item = a as unknown as { id: string; title: string; detail: string | null; severity: string; resolved_at: string | null; apps: { name: string } };
            return (
              <li key={item.id} className={`rounded-xl border border-glass-border bg-glass-surface p-3 flex gap-3 ${item.resolved_at ? "opacity-50" : ""}`}>
                <span className={`mt-1.5 inline-block w-2.5 h-2.5 rounded-full ${severityDot(item.severity)}`} />
                <div className="flex-1">
                  <p className="text-sm">{item.title}</p>
                  {item.detail && <p className="text-xs text-glass-text-secondary mt-1">{item.detail}</p>}
                  <p className="text-[10px] uppercase tracking-wider text-glass-text-tertiary mt-1 font-semibold">
                    {item.apps?.name} · {item.severity}
                  </p>
                </div>
              </li>
            );
          })}
          {(!actions || actions.length === 0) && <li className="text-glass-text-tertiary">No open action items.</li>}
        </ul>
      </section>
    </main>
  );
}
