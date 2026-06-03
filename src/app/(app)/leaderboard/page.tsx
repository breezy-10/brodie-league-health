import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ymd, daysAgo } from "@/lib/source-apps/util";
import { scoreColor } from "@/lib/colors";
import { TIER_ICON, TIER_LABEL, type Tier } from "@/lib/scoring/gamification";
import Link from "next/link";

type Scope = "today" | "yesterday" | "all_time";

const SCOPE_LABEL: Record<Scope, string> = {
  today: "Today",
  yesterday: "Yesterday",
  all_time: "All time",
};

export default async function Leaderboard({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const ctx = await requireUser();
  const sb = await createClient();
  const isAdmin = ctx.profile?.role === "dm" || ctx.profile?.role === "super_admin";
  const { scope: scopeRaw } = await searchParams;
  const scope: Scope =
    scopeRaw === "yesterday" || scopeRaw === "all_time" ? (scopeRaw as Scope) : "today";

  const today = ymd(new Date());
  const yesterday = ymd(daysAgo(new Date(), 1));

  type Row = {
    lm_id: string;
    full_name: string;
    location_name: string | null;
    district: string | null;
    current_streak: number;
    tier: Tier;
    avg_30d: number | null;
    total_xp: number;
    max_xp: number;
    pct: number;
    rank: number;
  };

  let rows: Row[] = [];

  if (scope === "today" || scope === "yesterday") {
    const date = scope === "today" ? today : yesterday;
    // active=true on the joined league_managers row excludes inactive LMs
    // (Jamie, etc) from the daily ranking even if they have a snapshot.
    const { data } = await sb
      .from("lm_xp_totals")
      .select(
        "lm_id, total_xp, max_xp, pct, league_managers!inner(full_name, location_name, district, current_streak, tier, avg_30d, active)"
      )
      .eq("snapshot_date", date)
      .eq("league_managers.active", true)
      .order("pct", { ascending: false })
      .limit(100);
    rows = ((data ?? []) as unknown as Array<{
      lm_id: string;
      total_xp: number;
      max_xp: number;
      pct: number;
      league_managers: {
        full_name: string;
        location_name: string | null;
        district: string | null;
        current_streak: number;
        tier: Tier;
        avg_30d: number | null;
      };
    }>).map((r, i) => ({
      lm_id: r.lm_id,
      full_name: r.league_managers.full_name,
      location_name: r.league_managers.location_name,
      district: r.league_managers.district,
      current_streak: r.league_managers.current_streak,
      tier: r.league_managers.tier,
      avg_30d: r.league_managers.avg_30d,
      total_xp: Number(r.total_xp),
      max_xp: Number(r.max_xp),
      pct: Number(r.pct),
      rank: i + 1,
    }));
  } else {
    // All-time: sum total_xp across every daily snapshot per LM, then join
    // roster info. Uses admin client to dodge RLS quirks on unfiltered
    // SELECT (the per-snapshot_date queries above use !inner joins so RLS
    // resolves cleanly, but an unfiltered query was returning empty).
    //
    // Opt-in filtering: enforced in code below. Non-admins only see opt-in
    // LMs + their own row. Matches the RLS semantics on lm_xp_totals.
    const admin = createAdminClient();
    const { data: totals } = await admin
      .from("lm_xp_totals")
      .select("lm_id, total_xp, max_xp")
      .limit(50000);
    const byLm = new Map<string, { total: number; max: number; days: number }>();
    for (const t of (totals ?? []) as Array<{ lm_id: string; total_xp: number; max_xp: number }>) {
      const cur = byLm.get(t.lm_id) ?? { total: 0, max: 0, days: 0 };
      cur.total += Number(t.total_xp);
      cur.max += Number(t.max_xp);
      cur.days += 1;
      byLm.set(t.lm_id, cur);
    }

    const lmIds = Array.from(byLm.keys());
    if (lmIds.length) {
      // Pull roster + opt-in via admin client too (so all-time view stays
      // consistent regardless of who's looking).
      // active=true filter so inactive LMs (Jamie etc) don't show up just
      // because they have old historical snapshots in lm_xp_totals.
      const { data: lmInfo } = await admin
        .from("league_managers")
        .select("id, full_name, location_name, district, current_streak, tier, avg_30d, email")
        .eq("active", true)
        .in("id", lmIds);
      type LMInfo = {
        id: string;
        full_name: string;
        location_name: string | null;
        district: string | null;
        current_streak: number;
        tier: Tier;
        avg_30d: number | null;
        email: string;
      };

      // For non-admins, get the opt-in set + the caller's own LM id.
      let visibleIds: Set<string> | null = null;
      if (!isAdmin) {
        const { data: optInProfiles } = await admin
          .from("profiles")
          .select("email")
          .eq("opt_in_leaderboard", true);
        const optInEmails = new Set(
          ((optInProfiles ?? []) as Array<{ email: string }>).map((p) => p.email.toLowerCase())
        );
        visibleIds = new Set(
          ((lmInfo ?? []) as LMInfo[])
            .filter(
              (l) =>
                optInEmails.has(l.email.toLowerCase()) ||
                l.email.toLowerCase() === (ctx.user.email ?? "").toLowerCase()
            )
            .map((l) => l.id)
        );
      }

      const lmById = new Map(((lmInfo ?? []) as LMInfo[]).map((l) => [l.id, l]));
      rows = lmIds
        .map((id): Row | null => {
          if (visibleIds && !visibleIds.has(id)) return null;
          const agg = byLm.get(id)!;
          const info = lmById.get(id);
          if (!info) return null;
          const pct = agg.max > 0 ? (agg.total / agg.max) * 100 : 0;
          return {
            lm_id: id,
            full_name: info.full_name,
            location_name: info.location_name,
            district: info.district,
            current_streak: info.current_streak,
            tier: info.tier,
            avg_30d: info.avg_30d,
            total_xp: agg.total,
            max_xp: agg.max,
            pct,
            rank: 0,
          };
        })
        .filter((x): x is Row => x !== null)
        .sort((a, b) => b.pct - a.pct)
        .map((r, i) => ({ ...r, rank: i + 1 }))
        .slice(0, 100);
    }
  }

  return (
    <main className="space-y-5 sm:space-y-6">
      <header>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Leaderboard</h1>
        <p className="text-glass-text-secondary text-sm mt-1">
          {scope === "today" && "Today's ranking. Opt out from My Day if you want off the board."}
          {scope === "yesterday" && "Yesterday's final ranking."}
          {scope === "all_time" && "Total XP earned across every day since you started."}
        </p>
      </header>

      <div className="flex gap-2 flex-wrap">
        {(["today", "yesterday", "all_time"] as Scope[]).map((s) => {
          const active = scope === s;
          return (
            <Link
              key={s}
              href={`/leaderboard?scope=${s}`}
              className="text-xs px-3 py-1.5 rounded-full font-semibold transition"
              style={{
                background: active ? "var(--accent)" : "var(--bg-raised)",
                color: active ? "var(--accent-text-on)" : "var(--text)",
                border: active ? "1px solid var(--accent)" : "1px solid var(--border)",
              }}
            >
              {SCOPE_LABEL[s]}
            </Link>
          );
        })}
      </div>

      <div className="rounded-2xl border border-glass-border bg-glass-surface overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead className="bg-glass-surface-hover text-glass-text-tertiary uppercase text-[10px] tracking-wider">
            <tr>
              <th className="text-left p-3 font-semibold w-12">Rank</th>
              <th className="text-left p-3 font-semibold">LM</th>
              <th className="text-left p-3 font-semibold">Tier</th>
              <th className="text-left p-3 font-semibold">Streak</th>
              <th className="text-right p-3 font-semibold">Score / 100</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              // Normalized 0-100 score. Every LM has the same max potential
              // regardless of how many locations / pay periods / etc they have,
              // because we use pct (already normalized per-LM) as the score.
              const score = Math.max(0, Math.min(100, Math.round(row.pct)));
              const isChamp = row.rank === 1;
              return (
                <tr
                  key={row.lm_id}
                  className={`border-t border-glass-border-light hover:bg-glass-surface-hover ${
                    isChamp ? "bg-glass-gold/5" : ""
                  }`}
                >
                  <td className="p-3 font-mono text-glass-text-secondary">
                    {isChamp ? <span className="text-glass-gold">🥇</span> : row.rank}
                  </td>
                  <td className="p-3">
                    <div>{row.full_name}</div>
                    <div className="text-xs text-glass-text-tertiary">
                      {row.location_name}
                      {row.district ? ` · ${row.district}` : ""}
                    </div>
                  </td>
                  <td className="p-3 text-xs">
                    <span title={`${Math.round(row.avg_30d ?? 0)}% / 30d avg`}>
                      {TIER_ICON[row.tier]} {TIER_LABEL[row.tier]}
                    </span>
                  </td>
                  <td className="p-3 text-xs">
                    {row.current_streak > 0 ? (
                      <span>🔥 {row.current_streak}d</span>
                    ) : (
                      <span className="text-glass-text-tertiary">—</span>
                    )}
                  </td>
                  <td className={`p-3 text-right font-semibold text-base ${scoreColor(score)}`}>
                    {score}
                    <span className="text-glass-text-tertiary text-xs font-normal"> / 100</span>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-glass-text-tertiary">
                  {scope === "today" && "No scores yet today."}
                  {scope === "yesterday" && "No scores recorded yesterday."}
                  {scope === "all_time" && "No history yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
