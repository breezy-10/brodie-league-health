import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ymd, daysAgo } from "@/lib/source-apps/util";
import { scoreColor, scoreBg } from "@/lib/colors";
import { AppCard } from "@/components/AppCard";
import { LeaderboardOptInToggle } from "@/components/LeaderboardOptInToggle";
import { TierBadge, StreakBadge, ChampionRibbon } from "@/components/GamificationBadges";
import { ViewAsBanner, ViewAsSwitcher } from "@/components/ViewAs";
import { LiveCountersStrip } from "@/components/LiveCounters";
import { MyDayRefresh } from "@/components/MyDayRefresh";
import { WelcomeTour } from "@/components/WelcomeTour";
import { ScoreHistoryChart } from "@/components/ScoreHistoryChart";
import { PersonalGoalEditor } from "@/components/PersonalGoalEditor";
import { logAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { iconForSlug } from "@/lib/badge-icons";
import { loadBonusProjection } from "@/lib/compensation";
import { BonusProjectionCard } from "@/components/BonusProjection";
import { loadLiveCounters } from "@/lib/live-counters";
import type { Tier } from "@/lib/scoring/gamification";
import Link from "next/link";

type LMRow = {
  id: string;
  full_name: string;
  email: string;
  location_name: string | null;
  district: string | null;
  current_streak: number;
  longest_streak: number;
  tier: Tier;
  avg_30d: number | null;
};

export default async function MyDay({
  searchParams,
}: {
  searchParams: Promise<{ lm?: string }>;
}) {
  const ctx = await requireUser();
  const sb = await createClient();
  const today = ymd(new Date());
  const sevenAgo = ymd(daysAgo(new Date(), 7));

  const { lm: viewAsId } = await searchParams;
  const isAdmin = ctx.profile?.role === "dm" || ctx.profile?.role === "super_admin";
  const viewingAs = isAdmin && !!viewAsId;

  // Audit: an admin pulled up another LM's page. Async, fire-and-forget.
  if (viewingAs) {
    logAudit({
      actorId: ctx.user.id,
      actorEmail: ctx.user.email ?? null,
      action: AUDIT_ACTIONS.VIEW_AS_OPENED,
      targetType: "lm",
      targetId: viewAsId,
      payload: { date: today },
    });
  }

  // Pick the LM row. If admin is viewing-as, use admin client to bypass RLS
  // (their own RLS would normally let them see other LMs anyway, but this is
  // explicit and faster).
  let lm: LMRow | null = null;
  if (viewingAs) {
    const admin = createAdminClient();
    const { data } = await admin
      .from("league_managers")
      .select("id, full_name, email, location_name, district, current_streak, longest_streak, tier, avg_30d")
      .eq("id", viewAsId)
      .maybeSingle();
    lm = (data ?? null) as LMRow | null;
  } else {
    // Self lookup. Use admin client so RLS edge cases never block a user
    // from seeing their OWN dashboard. Try multiple strategies because real
    // emails are messy:
    //   1. exact email match on profile.id → league_managers.profile_id
    //   2. exact email match (lowercase)
    //   3. case-insensitive email (ilike)
    //   4. last-ditch: re-sync the roster from CRM and try again — this
    //      handles "LM was added to CRM but cron hasn't run since"
    const admin = createAdminClient();
    const userEmail = (ctx.user.email ?? "").toLowerCase();
    const cols =
      "id, full_name, email, location_name, district, current_streak, longest_streak, tier, avg_30d, profile_id";

    // Strategy 1: by profile_id (if it's been linked)
    let { data } = await admin
      .from("league_managers")
      .select(cols)
      .eq("profile_id", ctx.user.id)
      .maybeSingle();

    // Strategy 2: by email exact (already lowercase in DB)
    if (!data && userEmail) {
      const r2 = await admin
        .from("league_managers")
        .select(cols)
        .eq("email", userEmail)
        .maybeSingle();
      data = r2.data;
    }

    // Strategy 3: case-insensitive ilike
    if (!data && userEmail) {
      const r3 = await admin
        .from("league_managers")
        .select(cols)
        .ilike("email", userEmail)
        .maybeSingle();
      data = r3.data;
    }

    // Strategy 4: self-heal. Sync the roster from CRM and retry once.
    // This is what "have them have active pages and just sync with the CRM
    // every day" means in practice — if you're a CRM manager and you log
    // in before the daily cron has caught you, we pull you in on the spot.
    if (!data && userEmail) {
      try {
        const { syncRoster } = await import("@/lib/roster");
        await syncRoster();
        const r4 = await admin
          .from("league_managers")
          .select(cols)
          .ilike("email", userEmail)
          .maybeSingle();
        data = r4.data;
      } catch {
        // sync failure shouldn't block the page; fall through to "no LM" state
      }
    }

    // Backfill the missing profile_id link so subsequent lookups hit
    // strategy 1 instantly.
    if (data && !(data as { profile_id: string | null }).profile_id) {
      admin
        .from("league_managers")
        .update({ profile_id: ctx.user.id })
        .eq("id", (data as { id: string }).id)
        .then(() => {}, () => {});
    }

    lm = (data ?? null) as LMRow | null;
  }

  // Admin-only roster for the switcher dropdown (lazy: only fetched when admin)
  let switcherOptions: Array<{ id: string; full_name: string; location_name: string | null }> = [];
  if (isAdmin) {
    const admin = createAdminClient();
    const { data: roster } = await admin
      .from("league_managers")
      .select("id, full_name, location_name")
      .eq("active", true)
      .order("full_name", { ascending: true });
    switcherOptions = (roster ?? []) as Array<{ id: string; full_name: string; location_name: string | null }>;
  }

  if (!lm) {
    return (
      <main className="space-y-6">
        {!viewingAs && ctx.profile?.id && (
          <WelcomeTour
            profileId={ctx.profile.id}
            tourCompletedAt={ctx.profile.tour_completed_at ?? null}
          />
        )}
        {viewingAs && <ViewAsBanner name="Unknown LM" options={switcherOptions} />}
        <h1 className="text-3xl font-semibold tracking-tight">Welcome.</h1>
        <p className="text-glass-text-secondary">
          {viewingAs
            ? "That LM isn't in our roster anymore."
            : "We don't see you in the CRM managers table yet. Ask an admin to add you, then refresh."}
        </p>
        {isAdmin && !viewingAs && (
          <div className="pt-4">
            <p className="text-xs text-glass-text-tertiary mb-2 uppercase tracking-wider font-semibold">
              You&apos;re an admin — view as any LM:
            </p>
            <ViewAsSwitcher options={switcherOptions} />
          </div>
        )}
      </main>
    );
  }

  const lmId = lm.id;

  // Always use the admin client for the page's data queries. We've already
  // pinned `lmId` to either:
  //   (a) the logged-in user's OWN league_managers row (their email match), or
  //   (b) the LM an admin is viewing-as.
  // Either way, every downstream query filters by .eq("lm_id", lmId), so
  // the user can never see data that isn't theirs.
  //
  // We were previously using the user-scoped client for self-views, but RLS
  // edge cases (planner quirks, NULL profile_id, current_lm_id() helper not
  // resolving) kept silently filtering out action items + snapshots for LMs.
  // The admin client makes "logged in → see your stuff" 100% reliable.
  const dataClient = createAdminClient();

  const { data: xpRow } = await dataClient
    .from("lm_xp_totals")
    .select("total_xp, max_xp, pct, rank_overall, breakdown")
    .eq("lm_id", lmId)
    .eq("snapshot_date", today)
    .maybeSingle();

  const { data: yesterdayRow } = await dataClient
    .from("lm_xp_totals")
    .select("pct")
    .eq("lm_id", lmId)
    .eq("snapshot_date", ymd(daysAgo(new Date(), 1)))
    .maybeSingle();

  // 30-day window for the score history chart. Existing weekly champ logic
  // still uses sevenAgo separately so this doesn't change ranking math.
  const thirtyAgo = ymd(daysAgo(new Date(), 30));
  const { data: trend } = await dataClient
    .from("lm_xp_totals")
    .select("snapshot_date, pct")
    .eq("lm_id", lmId)
    .gte("snapshot_date", thirtyAgo)
    .order("snapshot_date", { ascending: true });

  const { data: actions } = await dataClient
    .from("daily_action_items")
    .select("id, title, detail, severity, app_id, resolved_at, metrics:metric_id(slug, scoring_rule)")
    .eq("lm_id", lmId)
    .eq("snapshot_date", today)
    .order("severity", { ascending: true });

  const { data: apps } = await dataClient.from("apps").select("id, slug, name");
  const appNameById = new Map((apps ?? []).map((a: { id: string; name: string }) => [a.id, a.name]));
  const appNameBySlug = new Map((apps ?? []).map((a: { slug: string; name: string }) => [a.slug, a.name]));

  // Slug → uuid for every metric. AppCard needs this so its Dispute button
  // can POST a metric_id instead of just a slug. One small query, cached
  // implicitly by render.
  const { data: allMetrics } = await dataClient.from("metrics").select("id, slug");
  const metricIdBySlug = Object.fromEntries(
    ((allMetrics ?? []) as Array<{ id: string; slug: string }>).map((m) => [m.slug, m.id])
  );
  const metricSlugById = Object.fromEntries(
    ((allMetrics ?? []) as Array<{ id: string; slug: string }>).map((m) => [m.id, m.slug])
  );

  // Recent disputes this LM has filed (any status, last 14 days). We pass
  // resolved ones down to AppCard so the LM sees the DM's decision inline
  // when they next expand "Why?" — closes the trust loop.
  const fourteenAgo = ymd(daysAgo(new Date(), 14));
  const { data: recentDisputes } = await dataClient
    .from("metric_disputes")
    .select("id, metric_id, status, dm_note, score_adjustment, resolved_at, snapshot_date")
    .eq("lm_id", lmId)
    .gte("snapshot_date", fourteenAgo)
    .order("resolved_at", { ascending: false });

  // Build map: metricSlug → most-recent dispute for that metric in the window.
  type DisputeInfo = {
    status: string;
    dm_note: string | null;
    score_adjustment: number | null;
    resolved_at: string | null;
    snapshot_date: string;
  };
  const disputeBySlug: Record<string, DisputeInfo> = {};
  for (const d of (recentDisputes ?? []) as Array<{
    metric_id: string;
    status: string;
    dm_note: string | null;
    score_adjustment: number | null;
    resolved_at: string | null;
    snapshot_date: string;
  }>) {
    const slug = metricSlugById[d.metric_id];
    if (!slug) continue;
    if (!disputeBySlug[slug]) {
      disputeBySlug[slug] = {
        status: d.status,
        dm_note: d.dm_note,
        score_adjustment: d.score_adjustment,
        resolved_at: d.resolved_at,
        snapshot_date: d.snapshot_date,
      };
    }
  }

  const { data: recentUnlocks } = await dataClient
    .from("lm_achievements")
    .select("unlocked_at, achievements!inner(slug, name, icon)")
    .eq("lm_id", lmId)
    .gte("unlocked_at", sevenAgo)
    .order("unlocked_at", { ascending: false })
    .limit(5);

  // Live counters (current-season registrations, etc.) — fresh per page load.
  const liveCounters = await loadLiveCounters(lm.email);

  // Bonus projection card uses 30-day rolling avg pct from the LM's cached
  // gamification stats; falls back to today's pct if avg_30d is null.
  const bonusProjection = await loadBonusProjection(
    lm.id,
    Number(lm.avg_30d ?? (xpRow as { pct?: number } | null)?.pct ?? 0)
  );

  const todayRank = (xpRow as { rank_overall?: number } | null)?.rank_overall;
  const isDailyChamp = todayRank === 1;

  const { data: weekly } = await dataClient
    .from("lm_xp_totals")
    .select("lm_id, pct")
    .gte("snapshot_date", sevenAgo);
  const weeklySum = new Map<string, number>();
  for (const r of (weekly ?? []) as Array<{ lm_id: string; pct: number }>) {
    weeklySum.set(r.lm_id, (weeklySum.get(r.lm_id) ?? 0) + Number(r.pct));
  }
  const weeklyTop = [...weeklySum.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const isWeeklyChamp = weeklyTop === lmId;

  const pct = Math.round((xpRow as { pct?: number } | null)?.pct ?? 0);
  const xp = Math.round((xpRow as { total_xp?: number } | null)?.total_xp ?? 0);
  const maxXp = Math.round((xpRow as { max_xp?: number } | null)?.max_xp ?? 100);
  const yesterdayPct = (yesterdayRow as { pct?: number } | null)?.pct;
  const delta = yesterdayPct != null ? Math.round(pct - yesterdayPct) : null;
  const breakdown = ((xpRow as { breakdown?: Record<string, { score: number; max: number }> } | null)?.breakdown) ?? {};

  const firstName = (lm.full_name ?? ctx.user.email ?? "").split(" ")[0];

  return (
    <main className="space-y-5 sm:space-y-8">
      {!viewingAs && ctx.profile?.id && (
        <WelcomeTour
          profileId={ctx.profile.id}
          tourCompletedAt={ctx.profile.tour_completed_at ?? null}
        />
      )}
      {viewingAs && <ViewAsBanner name={lm.full_name} options={switcherOptions} />}

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <p className="text-glass-text-tertiary text-xs uppercase tracking-wider">
            {lm.location_name ?? "—"} {lm.district ? `· ${lm.district}` : ""}
          </p>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            {viewingAs ? `${lm.full_name}'s day` : `Good day, ${firstName}.`}
          </h1>
          <div className="flex flex-wrap gap-2 pt-1">
            <TierBadge tier={lm.tier} avg30d={lm.avg_30d} />
            <StreakBadge days={lm.current_streak ?? 0} />
            {isDailyChamp && <ChampionRibbon kind="daily" />}
            {isWeeklyChamp && !isDailyChamp && <ChampionRibbon kind="weekly" />}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          {!viewingAs && (
            <LeaderboardOptInToggle initial={ctx.profile?.opt_in_leaderboard ?? true} />
          )}
          <MyDayRefresh />
        </div>
      </header>

      <LiveCountersStrip counters={liveCounters} />

      {/* Bonus projection card — hidden until commission unlock logic is
          finalized. Flip NEXT_PUBLIC_SHOW_BONUS_PROJECTION=1 in Vercel env
          to surface it. Code + DB table stay in place. */}
      {process.env.NEXT_PUBLIC_SHOW_BONUS_PROJECTION === "1" && (
        <BonusProjectionCard projection={bonusProjection} />
      )}

      <section className={`rounded-2xl border p-4 sm:p-6 ${scoreBg(pct)}`}>
        <div className="flex items-end gap-4 sm:gap-6 flex-wrap">
          <div>
            <p className="uppercase text-[11px] text-glass-text-tertiary tracking-[0.08em] font-semibold">Today&apos;s XP</p>
            <p className={`text-5xl sm:text-6xl font-semibold tracking-tight ${scoreColor(pct)}`}>
              {xp}<span className="text-glass-text-tertiary text-xl sm:text-2xl"> / {maxXp}</span>
            </p>
            <p className="text-glass-text-secondary text-sm mt-1 flex items-center gap-2">
              <span>{pct}% of max</span>
              {todayRank && <span>· rank #{todayRank}</span>}
              {delta != null && delta !== 0 && (
                <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${delta > 0 ? "bg-green-500/15 text-green-300" : "bg-red-500/15 text-red-300"}`}>
                  {delta > 0 ? "▲" : "▼"} {Math.abs(delta)} vs yest.
                </span>
              )}
            </p>
          </div>
          <div className="flex-1 w-full sm:min-w-[260px]">
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
              <p className="uppercase text-[11px] text-glass-text-tertiary tracking-[0.08em] font-semibold">Last 30 days</p>
              {!viewingAs && (
                <PersonalGoalEditor initial={ctx.profile?.personal_goal_pct ?? null} />
              )}
            </div>
            <ScoreHistoryChart
              points={((trend ?? []) as Array<{ snapshot_date: string; pct: number }>).map((t) => ({
                d: t.snapshot_date,
                p: Math.round(t.pct),
              }))}
              goal={viewingAs ? null : ctx.profile?.personal_goal_pct ?? null}
            />
          </div>
        </div>
      </section>

      {(recentUnlocks ?? []).length > 0 && (
        <section className="rounded-2xl border border-glass-gold/30 bg-glass-gold/5 p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs uppercase tracking-wider text-glass-gold font-semibold">Recently unlocked</p>
            <Link href={viewingAs ? `/achievements?lm=${lm.id}` : "/achievements"} className="text-xs text-glass-text-tertiary hover:text-glass-text">Full cabinet →</Link>
          </div>
          <div className="flex flex-wrap gap-2">
            {((recentUnlocks ?? []) as unknown as Array<{ unlocked_at: string; achievements: { slug: string; name: string; icon: string } }>).map((u, i) => {
              const src = iconForSlug(u.achievements.slug);
              return (
                <span key={i} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-glass-surface-hover border border-glass-gold/30 text-sm">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" width={20} height={20} style={{ width: 20, height: 20, objectFit: "contain" }} />
                  <span className="font-semibold">{u.achievements.name}</span>
                </span>
              );
            })}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-base font-semibold">By app</h2>
        {Object.keys(breakdown).length === 0 && (
          <p className="text-glass-text-secondary">No data yet. Admin needs to run a sync.</p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Object.entries(breakdown).map(([slug, v]) => {
            const appActionsForSlug = (actions ?? [])
              .filter((a) => {
                const it = a as unknown as { app_id: string };
                return appNameBySlug.get(slug) === appNameById.get(it.app_id);
              })
              .map((a) => {
                const it = a as unknown as {
                  id: string;
                  title: string;
                  detail: string | null;
                  severity: string;
                  app_id: string;
                  resolved_at: string | null;
                  metrics: { slug: string; scoring_rule: { type?: string; xp_per_unit?: number; xp?: number } } | null;
                };
                const rule = it.metrics?.scoring_rule ?? {};
                // Resolvable reward (LM clicks Done to claim) → positive XP
                // Otherwise, surface the per-unit XP value (positive or negative)
                // so penalties show as "−3" etc.
                const xpReward =
                  rule.type === "reward_on_resolve"
                    ? Number(rule.xp_per_unit ?? 0)
                    : Number(rule.xp_per_unit ?? rule.xp ?? 0);
                return {
                  id: it.id,
                  title: it.title,
                  detail: it.detail,
                  severity: it.severity,
                  resolved_at: it.resolved_at,
                  xpReward,
                };
              });
            const subMetrics = (v as { metrics?: Record<string, { score: number; max: number }> }).metrics;
            return (
              <AppCard
                key={slug}
                appSlug={slug}
                appName={appNameBySlug.get(slug) ?? slug}
                score={v.score}
                max={v.max}
                actions={appActionsForSlug}
                metrics={subMetrics}
                metricIdBySlug={metricIdBySlug}
                snapshotDate={today}
                lmId={viewingAs ? lmId : undefined}
                disputable={!viewingAs}
                disputesByMetricSlug={disputeBySlug}
                readOnly={viewingAs}
              />
            );
          })}
        </div>
      </section>
    </main>
  );
}

// (old inline Sparkline removed — replaced by <ScoreHistoryChart />)
