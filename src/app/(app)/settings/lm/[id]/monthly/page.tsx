import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import Link from "next/link";

/**
 * Monthly performance pack. Default = current month; ?month=YYYY-MM jumps
 * to a specific month. Print-friendly so DMs can hit Cmd+P → save as PDF
 * for review meetings.
 */
const APP_LABEL: Record<string, string> = {
  crm: "Brodie CRM",
  facilities: "Facilities",
  ref_payroll: "Ref Payroll",
  training: "Training",
  stats_health: "Stats Health",
  content_health: "Content Health",
  checklist: "Seasonal Checklist",
  ops_schedule: "Ops Schedule",
  ramp: "New-LM Ramp Credit",
};

function monthRange(monthStr: string): { from: string; to: string; label: string } {
  // monthStr = YYYY-MM
  const [y, m] = monthStr.split("-").map((s) => parseInt(s, 10));
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 0));
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    label: from.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
  };
}

function currentMonthStr(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function MonthlyPack({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  await requireRole(["super_admin"]);
  const { id } = await params;
  const { month: queryMonth } = await searchParams;
  const monthStr = queryMonth ?? currentMonthStr();
  const range = monthRange(monthStr);

  const sb = createAdminClient();

  const { data: lm } = await sb
    .from("league_managers")
    .select("id, full_name, email, location_name, district, tier")
    .eq("id", id)
    .maybeSingle();
  if (!lm) return <p className="p-6">LM not found.</p>;
  const lmRow = lm as { id: string; full_name: string; email: string; location_name: string | null; district: string | null; tier: string | null };

  // Daily XP across the month
  const { data: daysData } = await sb
    .from("lm_xp_totals")
    .select("snapshot_date, total_xp, max_xp, pct, rank_overall, breakdown")
    .eq("lm_id", id)
    .gte("snapshot_date", range.from)
    .lte("snapshot_date", range.to)
    .order("snapshot_date", { ascending: true });
  type DayRow = { snapshot_date: string; total_xp: number; max_xp: number; pct: number; rank_overall: number | null; breakdown: Record<string, { score: number; max: number }> };
  const days = (daysData ?? []) as DayRow[];

  const totalXp = days.reduce((s, d) => s + Number(d.total_xp), 0);
  const totalMax = days.reduce((s, d) => s + Number(d.max_xp), 0);
  const monthPct = totalMax > 0 ? Math.round((totalXp / totalMax) * 100) : 0;
  const avgDailyXp = days.length ? Math.round(totalXp / days.length) : 0;
  const bestDay = [...days].sort((a, b) => Number(b.total_xp) - Number(a.total_xp))[0];
  const worstDay = [...days].sort((a, b) => Number(a.total_xp) - Number(b.total_xp))[0];
  const bestRank = Math.min(...days.map((d) => d.rank_overall ?? 999));

  // Aggregate by app across the month
  const appSum = new Map<string, { score: number; max: number }>();
  for (const d of days) {
    for (const [slug, v] of Object.entries(d.breakdown ?? {})) {
      const cur = appSum.get(slug) ?? { score: 0, max: 0 };
      cur.score += Number(v.score);
      cur.max += Number(v.max);
      appSum.set(slug, cur);
    }
  }
  const appRows = [...appSum.entries()]
    .map(([slug, v]) => ({ slug, score: v.score, max: v.max, pct: v.max > 0 ? (v.score / v.max) * 100 : 0 }))
    .sort((a, b) => b.score - a.score);

  // Achievements unlocked in this month
  const { data: unlocks } = await sb
    .from("lm_achievements")
    .select("unlocked_at, achievements!inner(slug, name, icon, description)")
    .eq("lm_id", id)
    .gte("unlocked_at", range.from + "T00:00:00Z")
    .lte("unlocked_at", range.to + "T23:59:59Z")
    .order("unlocked_at", { ascending: true });
  type Unlock = { unlocked_at: string; achievements: { slug: string; name: string; icon: string; description: string } };

  return (
    <main className="space-y-6 max-w-4xl print:max-w-none print:p-0">
      <div className="print:hidden">
        <Link href={`/settings/lm/${id}`} className="text-xs" style={{ color: "var(--text-mute)" }}>
          &larr; Back to {lmRow.full_name}
        </Link>
      </div>

      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="uppercase text-[10px] tracking-[0.08em] font-semibold" style={{ color: "var(--accent)" }}>
            Monthly review · {range.label}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight mt-1">{lmRow.full_name}</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-mute)" }}>
            {lmRow.location_name} · {lmRow.tier?.replace(/_/g, " ")} · {lmRow.email}
          </p>
        </div>
        <button
          onClick={undefined /* CSS-only print, handled by browser Cmd+P */}
          className="print:hidden text-xs px-3 py-1.5 rounded-full font-semibold"
          style={{
            background: "var(--accent-soft)",
            color: "var(--accent)",
            border: "1px solid rgba(242, 169, 0, 0.5)",
          }}
        >
          <a href={`#`} onClick={(e) => { e.preventDefault(); window.print(); }}>Print / Save PDF →</a>
        </button>
      </header>

      <section className="rounded-2xl border p-5" style={{ background: "var(--bg-raised)", borderColor: "var(--border)" }}>
        <h2 className="text-base font-semibold mb-3">Month summary</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <Stat label="Total XP" value={Math.round(totalXp).toLocaleString()} />
          <Stat label="Of max" value={`${monthPct}%`} />
          <Stat label="Avg daily XP" value={avgDailyXp.toLocaleString()} />
          <Stat label="Best rank" value={bestRank !== 999 ? `#${bestRank}` : "—"} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3 text-sm">
          <Stat label="Best day" value={bestDay ? `${Math.round(Number(bestDay.total_xp))} XP on ${bestDay.snapshot_date}` : "—"} />
          <Stat label="Lowest day" value={worstDay ? `${Math.round(Number(worstDay.total_xp))} XP on ${worstDay.snapshot_date}` : "—"} />
        </div>
      </section>

      <section className="rounded-2xl border p-5" style={{ background: "var(--bg-raised)", borderColor: "var(--border)" }}>
        <h2 className="text-base font-semibold mb-3">By app — month total</h2>
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          <table className="w-full text-sm">
            <thead className="uppercase text-[10px] tracking-wider" style={{ background: "var(--bg-hover)", color: "var(--text-mute)" }}>
              <tr>
                <th className="text-left p-2 font-semibold">App</th>
                <th className="text-right p-2 font-semibold">XP earned</th>
                <th className="text-right p-2 font-semibold">Max</th>
                <th className="text-right p-2 font-semibold">% of max</th>
              </tr>
            </thead>
            <tbody>
              {appRows.map((r) => (
                <tr key={r.slug} className="border-t" style={{ borderColor: "var(--border)" }}>
                  <td className="p-2">{APP_LABEL[r.slug] ?? r.slug}</td>
                  <td className="p-2 text-right font-mono" style={{ color: r.score > 0 ? "var(--ok)" : r.score < 0 ? "var(--error)" : "var(--text-mute)" }}>
                    {r.score > 0 ? "+" : ""}{Math.round(r.score)}
                  </td>
                  <td className="p-2 text-right" style={{ color: "var(--text-mute)" }}>{Math.round(r.max)}</td>
                  <td className="p-2 text-right">{Math.round(r.pct)}%</td>
                </tr>
              ))}
              {appRows.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-4 text-center" style={{ color: "var(--text-mute)" }}>
                    No data for this month.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border p-5" style={{ background: "var(--bg-raised)", borderColor: "var(--border)" }}>
        <h2 className="text-base font-semibold mb-3">Achievements unlocked this month</h2>
        {((unlocks ?? []) as unknown as Unlock[]).length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-mute)" }}>None this month.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {((unlocks ?? []) as unknown as Unlock[]).map((u, i) => (
              <li
                key={i}
                className="flex items-start gap-3 p-3 rounded-lg"
                style={{ background: "var(--bg-sunken)", border: "1px solid var(--border)" }}
              >
                <div className="text-xl">{u.achievements.icon}</div>
                <div className="flex-1">
                  <p className="font-semibold">{u.achievements.name}</p>
                  <p className="text-xs" style={{ color: "var(--text-mute)" }}>{u.achievements.description}</p>
                </div>
                <p className="text-[11px] font-mono" style={{ color: "var(--text-mute)" }}>
                  {u.unlocked_at.slice(0, 10)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs print:hidden" style={{ color: "var(--text-mute)" }}>
        Generated {new Date().toISOString().slice(0, 10)}. Print this page (Cmd+P) and save as PDF for the review packet.
      </p>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg p-3" style={{ background: "var(--bg-sunken)", border: "1px solid var(--border)" }}>
      <p className="uppercase text-[10px] tracking-wider font-semibold" style={{ color: "var(--text-mute)" }}>{label}</p>
      <p className="text-lg font-semibold mt-0.5" style={{ color: "var(--text)" }}>{value}</p>
    </div>
  );
}
