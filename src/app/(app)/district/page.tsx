import { requireRole } from "@/lib/auth";
import { loadDistrict } from "@/lib/district";
import { ymd } from "@/lib/source-apps/util";
import { scoreColor } from "@/lib/colors";
import Link from "next/link";

export default async function District({
  searchParams,
}: {
  searchParams: Promise<{ all?: string }>;
}) {
  const ctx = await requireRole(["dm", "super_admin"]);
  const { all } = await searchParams;
  const showAll = all === "1" || ctx.profile?.role === "super_admin";

  const today = ymd(new Date());
  const { lms, dmName } = await loadDistrict(
    ctx.user.email ?? "",
    today,
    ctx.profile?.role === "super_admin" && !all ? false : showAll
  );

  return (
    <main className="space-y-6">
      <header>
        <p className="text-[10px] uppercase tracking-[0.08em] font-semibold" style={{ color: "var(--text-mute)" }}>
          District view
        </p>
        <h1 className="text-3xl font-semibold tracking-tight mt-1">
          {dmName ? `${dmName}'s district` : "All league managers"}
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-mute)" }}>
          {lms.length} LM{lms.length === 1 ? "" : "s"} · ranked by today's XP · click a row for 1:1 prep
        </p>
      </header>

      <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--bg-raised)" }}>
        <table className="w-full text-sm">
          <thead className="uppercase text-[10px] tracking-wider" style={{ background: "var(--bg-hover)", color: "var(--text-mute)" }}>
            <tr>
              <th className="text-left p-3 font-semibold">LM</th>
              <th className="text-left p-3 font-semibold">Location</th>
              <th className="text-left p-3 font-semibold">Tier</th>
              <th className="text-left p-3 font-semibold">Streak</th>
              <th className="text-right p-3 font-semibold">Today</th>
              <th className="text-right p-3 font-semibold">30d avg</th>
              <th className="text-right p-3 font-semibold">⚠ open</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {lms.map((lm) => {
              const pct = Math.round(lm.today_pct ?? 0);
              return (
                <tr key={lm.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                  <td className="p-3">{lm.name}</td>
                  <td className="p-3" style={{ color: "var(--text-mute)" }}>{lm.location_name}</td>
                  <td className="p-3 text-xs">{lm.tier ? lm.tier.replace(/_/g, " ") : "—"}</td>
                  <td className="p-3 text-xs">{lm.current_streak ? `🔥 ${lm.current_streak}d` : <span style={{ color: "var(--text-mute)" }}>—</span>}</td>
                  <td className={`p-3 text-right font-semibold ${scoreColor(pct)}`}>
                    {lm.today_xp != null ? Math.round(lm.today_xp) : "—"} <span className="text-xs font-normal" style={{ color: "var(--text-mute)" }}>{lm.today_xp != null ? `(${pct}%)` : ""}</span>
                  </td>
                  <td className="p-3 text-right text-xs" style={{ color: "var(--text-mute)" }}>
                    {lm.avg_30d != null ? `${Math.round(lm.avg_30d)}%` : "—"}
                  </td>
                  <td className="p-3 text-right">
                    {lm.open_critical_count > 0 ? (
                      <span
                        className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold"
                        style={{ background: "rgba(200, 16, 46, 0.12)", color: "var(--error)", border: "1px solid rgba(200, 16, 46, 0.4)" }}
                      >
                        {lm.open_critical_count}
                      </span>
                    ) : (
                      <span style={{ color: "var(--text-mute)" }}>·</span>
                    )}
                  </td>
                  <td className="p-3 text-right space-x-2 whitespace-nowrap">
                    <Link
                      href={`/district/prep/${lm.id}`}
                      className="text-[11px] px-2.5 py-1 rounded-md font-semibold"
                      style={{
                        background: "var(--accent-soft)",
                        color: "var(--accent)",
                        border: "1px solid rgba(242, 169, 0, 0.45)",
                      }}
                    >
                      1:1 prep →
                    </Link>
                    <Link href={`/?lm=${lm.id}`} className="text-[11px]" style={{ color: "var(--text-mute)" }}>
                      View day
                    </Link>
                  </td>
                </tr>
              );
            })}
            {lms.length === 0 && (
              <tr>
                <td colSpan={8} className="p-8 text-center" style={{ color: "var(--text-mute)" }}>
                  No LMs report to you yet. Make sure your CRM <span className="font-mono">managers.reports_to</span> mappings are up to date.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
