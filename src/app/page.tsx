import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ymd, daysAgo } from "@/lib/source-apps/util";
import { scoreColor, scoreBg } from "@/lib/colors";
import { ActionItemRow } from "@/components/ActionItemRow";
import { LeaderboardOptInToggle } from "@/components/LeaderboardOptInToggle";

export default async function MyDay() {
  const ctx = await requireUser();
  const sb = await createClient();
  const today = ymd(new Date());
  const sevenAgo = ymd(daysAgo(new Date(), 7));

  const { data: lm } = await sb
    .from("league_managers")
    .select("id, full_name, location_name, district")
    .eq("email", (ctx.user.email ?? "").toLowerCase())
    .maybeSingle();

  if (!lm) {
    return (
      <main className="space-y-6">
        <h1 className="text-3xl font-bold">Welcome.</h1>
        <p className="text-brodie-dim">
          We don&apos;t see you in the CRM managers table yet. Ask an admin to add you, then refresh.
        </p>
      </main>
    );
  }

  const { data: xpRow } = await sb
    .from("lm_xp_totals")
    .select("total_xp, max_xp, pct, rank_overall, breakdown")
    .eq("lm_id", (lm as { id: string }).id)
    .eq("snapshot_date", today)
    .maybeSingle();

  const { data: trend } = await sb
    .from("lm_xp_totals")
    .select("snapshot_date, pct")
    .eq("lm_id", (lm as { id: string }).id)
    .gte("snapshot_date", sevenAgo)
    .order("snapshot_date", { ascending: true });

  const { data: actions } = await sb
    .from("daily_action_items")
    .select("id, title, detail, severity, app_id, resolved_at")
    .eq("lm_id", (lm as { id: string }).id)
    .eq("snapshot_date", today)
    .order("severity", { ascending: true });

  const { data: apps } = await sb.from("apps").select("id, slug, name");
  const appNameById = new Map((apps ?? []).map((a: { id: string; name: string }) => [a.id, a.name]));
  const appNameBySlug = new Map((apps ?? []).map((a: { slug: string; name: string }) => [a.slug, a.name]));

  const pct = Math.round((xpRow as { pct?: number } | null)?.pct ?? 0);
  const xp = Math.round((xpRow as { total_xp?: number } | null)?.total_xp ?? 0);
  const maxXp = Math.round((xpRow as { max_xp?: number } | null)?.max_xp ?? 100);
  const rank = (xpRow as { rank_overall?: number } | null)?.rank_overall;
  const breakdown = ((xpRow as { breakdown?: Record<string, { score: number; max: number; metrics?: Record<string, { score: number; max: number }> }> } | null)?.breakdown) ?? {};

  const lmInfo = lm as { full_name: string; location_name: string | null; district: string | null };
  const firstName = (lmInfo.full_name ?? ctx.user.email ?? "").split(" ")[0];

  return (
    <main className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-brodie-dim text-sm">{lmInfo.location_name ?? "—"} {lmInfo.district ? `· ${lmInfo.district}` : ""}</p>
          <h1 className="text-3xl font-display font-bold">Good day, {firstName}.</h1>
        </div>
        <LeaderboardOptInToggle initial={ctx.profile?.opt_in_leaderboard ?? true} />
      </header>

      <section className={`rounded-2xl border p-6 ${scoreBg(pct)}`}>
        <div className="flex items-end gap-6 flex-wrap">
          <div>
            <p className="uppercase text-xs text-brodie-dim tracking-wider">Today&apos;s XP</p>
            <p className={`text-6xl font-display font-bold ${scoreColor(pct)}`}>{xp}<span className="text-brodie-dim text-2xl"> / {maxXp}</span></p>
            <p className="text-brodie-dim text-sm mt-1">{pct}% of max{rank ? ` · rank #${rank} overall` : ""}</p>
          </div>
          <div className="flex-1 min-w-[240px]">
            <p className="uppercase text-xs text-brodie-dim tracking-wider mb-2">Last 7 days</p>
            <Sparkline points={((trend ?? []) as Array<{ snapshot_date: string; pct: number }>).map((t) => ({ d: t.snapshot_date, p: Math.round(t.pct) }))} />
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-display font-bold mb-3">By app</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Object.entries(breakdown).map(([slug, v]) => {
            const p = Math.round((v.score / Math.max(v.max, 1)) * 100);
            return (
              <div key={slug} className={`rounded-lg border border-brodie-line p-4 ${scoreBg(p).replace("bg-", "bg-").split(" ")[0]}/40`}>
                <p className="text-brodie-dim text-xs uppercase tracking-wider">{appNameBySlug.get(slug) ?? slug}</p>
                <p className={`text-2xl font-display font-bold ${scoreColor(p)}`}>{p}%</p>
                <p className="text-brodie-dim text-xs">{Math.round(v.score)} / {Math.round(v.max)} pts</p>
              </div>
            );
          })}
          {Object.keys(breakdown).length === 0 && (
            <p className="text-brodie-dim col-span-full">No data yet. Admin needs to run a sync.</p>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-display font-bold mb-3">
          Today&apos;s focus
          {actions?.length ? (
            <span className="text-brodie-dim text-sm ml-2">{actions.filter((a: { resolved_at: string | null }) => !a.resolved_at).length} open</span>
          ) : null}
        </h2>
        <ul className="space-y-2">
          {(actions ?? []).map((a) => {
            const item = a as { id: string; title: string; detail: string | null; severity: string; app_id: string; resolved_at: string | null };
            return (
              <ActionItemRow
                key={item.id}
                id={item.id}
                title={item.title}
                detail={item.detail}
                severity={item.severity}
                appName={appNameById.get(item.app_id) ?? ""}
                resolvedAt={item.resolved_at}
              />
            );
          })}
          {(!actions || actions.length === 0) && (
            <li className="text-brodie-dim">Clean board. Keep stacking.</li>
          )}
        </ul>
      </section>
    </main>
  );
}

function Sparkline({ points }: { points: Array<{ d: string; p: number }> }) {
  if (!points.length) return <p className="text-brodie-dim text-sm">No history yet.</p>;
  const w = 260, h = 60, pad = 4;
  const max = 100;
  const min = 0;
  const step = points.length > 1 ? (w - pad * 2) / (points.length - 1) : 0;
  const path = points
    .map((p, i) => {
      const x = pad + i * step;
      const y = h - pad - ((p.p - min) / (max - min)) * (h - pad * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} className="text-brodie-accent">
      <path d={path} fill="none" stroke="currentColor" strokeWidth={2} />
      {points.map((p, i) => {
        const x = pad + i * step;
        const y = h - pad - ((p.p - min) / (max - min)) * (h - pad * 2);
        return <circle key={i} cx={x} cy={y} r={2.5} fill="currentColor" />;
      })}
    </svg>
  );
}
