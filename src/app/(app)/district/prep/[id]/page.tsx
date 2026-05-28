import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ymd, daysAgo } from "@/lib/source-apps/util";
import Link from "next/link";

/**
 * Auto-generated 1:1 agenda for a DM meeting with their LM. Pulls from
 * the LM's recent XP trend, top open action items, and current tier to
 * compose talking points. Copy-paste into your meeting notes.
 */
export default async function OneOnOnePrep({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["dm", "super_admin"]);
  const { id } = await params;
  const sb = createAdminClient();
  const today = ymd(new Date());
  const sevenAgo = ymd(daysAgo(new Date(), 7));
  const thirtyAgo = ymd(daysAgo(new Date(), 30));

  const { data: lm } = await sb
    .from("league_managers")
    .select("id, full_name, email, location_name, district, tier, current_streak, longest_streak, avg_30d")
    .eq("id", id)
    .maybeSingle();
  if (!lm) return <p className="p-6">LM not found.</p>;
  const lmRow = lm as {
    id: string; full_name: string; email: string; location_name: string | null; district: string | null;
    tier: string | null; current_streak: number | null; longest_streak: number | null; avg_30d: number | null;
  };

  // Last 7d xp + 30d trend
  const { data: trend } = await sb
    .from("lm_xp_totals")
    .select("snapshot_date, total_xp, pct, breakdown")
    .eq("lm_id", id)
    .gte("snapshot_date", thirtyAgo)
    .order("snapshot_date", { ascending: false });
  const trendRows = (trend ?? []) as Array<{ snapshot_date: string; total_xp: number; pct: number; breakdown: Record<string, { score: number; max: number }> }>;

  // 7d vs prior 7d
  const last7 = trendRows.filter((r) => r.snapshot_date >= sevenAgo);
  const prior7 = trendRows.filter((r) => r.snapshot_date < sevenAgo && r.snapshot_date >= ymd(daysAgo(new Date(), 14)));
  const last7Avg = last7.length ? last7.reduce((s, r) => s + Number(r.pct), 0) / last7.length : 0;
  const prior7Avg = prior7.length ? prior7.reduce((s, r) => s + Number(r.pct), 0) / prior7.length : 0;
  const weekDelta = last7Avg - prior7Avg;

  // Best / worst app this week
  const appAgg = new Map<string, { score: number; max: number }>();
  for (const row of last7) {
    for (const [slug, v] of Object.entries(row.breakdown ?? {})) {
      const cur = appAgg.get(slug) ?? { score: 0, max: 0 };
      cur.score += Number(v.score ?? 0);
      cur.max += Number(v.max ?? 0);
      appAgg.set(slug, cur);
    }
  }
  const appAggArr = [...appAgg.entries()]
    .map(([slug, v]) => ({ slug, pct: v.max > 0 ? (v.score / v.max) * 100 : 0, score: v.score }))
    .filter((a) => a.max !== 0 || a.score !== 0);
  const bestApp = [...appAggArr].sort((a, b) => b.pct - a.pct)[0];
  const worstApp = [...appAggArr].sort((a, b) => a.pct - b.pct)[0];

  // Top 5 open action items
  const { data: openActions } = await sb
    .from("daily_action_items")
    .select("title, severity, apps!inner(name)")
    .eq("lm_id", id)
    .eq("snapshot_date", today)
    .is("resolved_at", null)
    .order("severity", { ascending: true })
    .limit(8);

  // Synthesize coaching prompts based on the data
  const prompts: string[] = [];
  if (lmRow.current_streak && lmRow.current_streak >= 3) {
    prompts.push(`Celebrate: ${lmRow.current_streak}-day streak at 80%+. Ask what's clicking.`);
  }
  if (weekDelta < -10) {
    prompts.push(`Week-over-week declined ${Math.abs(Math.round(weekDelta))}%. Open with: "Talk to me about last week — what got in the way?"`);
  }
  if (weekDelta > 10) {
    prompts.push(`Week-over-week up ${Math.round(weekDelta)}%. Ask what changed; capture for the playbook.`);
  }
  if (worstApp && worstApp.pct < 0) {
    prompts.push(`Worst app this week: ${appName(worstApp.slug)} at ${Math.round(worstApp.pct)}%. Specific behavior to address, not a vague pep talk.`);
  }
  if (lmRow.avg_30d != null && lmRow.avg_30d < 30) {
    prompts.push(`30-day avg is ${Math.round(Number(lmRow.avg_30d))}% — sustained low. Discuss whether this is the right role fit, not just performance.`);
  }
  if ((openActions ?? []).filter((a: { severity: string }) => a.severity === "critical").length > 0) {
    prompts.push(`Critical items piled up — work through them together on the call, don't just hand them over.`);
  }

  return (
    <main className="space-y-6 max-w-3xl">
      <Link href="/district" className="text-xs" style={{ color: "var(--text-mute)" }}>&larr; Back to district</Link>

      <header>
        <p className="uppercase text-[10px] tracking-[0.08em] font-semibold" style={{ color: "var(--accent)" }}>
          1:1 prep
        </p>
        <h1 className="text-3xl font-semibold tracking-tight mt-1">{lmRow.full_name}</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-mute)" }}>
          {lmRow.location_name} · {lmRow.tier?.replace(/_/g, " ")} · {lmRow.email}
        </p>
      </header>

      <section className="rounded-2xl border p-5" style={{ background: "var(--bg-raised)", borderColor: "var(--border)" }}>
        <h2 className="text-base font-semibold mb-3">Snapshot</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <Stat label="30-day avg" value={lmRow.avg_30d != null ? `${Math.round(Number(lmRow.avg_30d))}%` : "—"} />
          <Stat label="Last 7d avg" value={`${Math.round(last7Avg)}%`} />
          <Stat label="Week vs prior" value={`${weekDelta >= 0 ? "+" : ""}${Math.round(weekDelta)}%`} accent={weekDelta < 0 ? "bad" : weekDelta > 0 ? "good" : undefined} />
          <Stat label="Streak" value={`${lmRow.current_streak ?? 0}d (best ${lmRow.longest_streak ?? 0})`} />
        </div>
      </section>

      <section className="rounded-2xl border p-5" style={{ background: "var(--bg-raised)", borderColor: "var(--border)" }}>
        <h2 className="text-base font-semibold mb-3">Talking points</h2>
        {prompts.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-mute)" }}>
            Nothing red. Easy week. Ask about wins + reinforce the routines that are working.
          </p>
        ) : (
          <ol className="space-y-2 text-sm list-decimal pl-5">
            {prompts.map((p, i) => <li key={i}>{p}</li>)}
          </ol>
        )}
      </section>

      <section className="rounded-2xl border p-5" style={{ background: "var(--bg-raised)", borderColor: "var(--border)" }}>
        <h2 className="text-base font-semibold mb-3">App performance — last 7d</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
          {appAggArr.sort((a, b) => b.pct - a.pct).map((a) => (
            <div
              key={a.slug}
              className="flex items-center justify-between p-2 rounded-lg"
              style={{ background: "var(--bg-sunken)", border: "1px solid var(--border)" }}
            >
              <span>{appName(a.slug)}</span>
              <span className="font-mono text-xs" style={{ color: a.pct >= 70 ? "var(--ok)" : a.pct >= 40 ? "var(--warn)" : "var(--error)" }}>
                {Math.round(a.pct)}%
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border p-5" style={{ background: "var(--bg-raised)", borderColor: "var(--border)" }}>
        <h2 className="text-base font-semibold mb-3">Open action items to work through</h2>
        {(openActions ?? []).length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-mute)" }}>Clean board.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {((openActions ?? []) as unknown as Array<{ title: string; severity: string; apps: { name: string } }>).map((a, i) => (
              <li key={i} className="flex items-center justify-between p-2 rounded-lg" style={{ background: "var(--bg-sunken)", border: "1px solid var(--border)" }}>
                <span>{a.title}</span>
                <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: "var(--text-mute)" }}>{a.apps?.name}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs" style={{ color: "var(--text-mute)" }}>
        Generated from {today}. Refresh after the next sync for updated numbers.
      </p>
    </main>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: "good" | "bad" }) {
  return (
    <div className="rounded-lg p-3" style={{ background: "var(--bg-sunken)", border: "1px solid var(--border)" }}>
      <p className="uppercase text-[10px] tracking-wider font-semibold" style={{ color: "var(--text-mute)" }}>{label}</p>
      <p
        className="text-lg font-semibold mt-0.5"
        style={{ color: accent === "good" ? "var(--ok)" : accent === "bad" ? "var(--error)" : "var(--text)" }}
      >
        {value}
      </p>
    </div>
  );
}

function appName(slug: string): string {
  return ({
    crm: "Brodie CRM",
    facilities: "Facilities",
    ref_payroll: "Ref Payroll",
    training: "Training",
    stats_health: "Stats Health",
    content_health: "Content Health",
    checklist: "Seasonal Checklist",
    ops_schedule: "Ops Schedule",
  } as Record<string, string>)[slug] ?? slug;
}
