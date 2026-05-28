/**
 * Bonus projection math. Reads compensation_config + compensation_overrides
 * + the LM's recent XP history, projects what they're on pace to earn this
 * quarter (and full year).
 *
 * Model: annual_base × unlock_share × pro_rata_period.
 *   unlock_share comes from rolling 30-day pct vs the tier ladder defined
 *   in compensation_config.unlock_rules.by_monthly_avg_pct.
 */
import { createAdminClient } from "@/lib/supabase/admin";

export type UnlockRule = { min_avg_pct: number; share: number; label: string };
export type CompConfig = {
  annual_base_cents: number;
  unlock_rules: { by_monthly_avg_pct: UnlockRule[] };
};

export type BonusProjection = {
  annual_base_cents: number;
  current_avg_pct: number;
  unlock_share: number;
  unlock_label: string;
  projected_annual_cents: number;
  projected_quarter_cents: number;
  projected_month_cents: number;
  next_tier: UnlockRule | null;
  pct_to_next_tier: number | null;
};

export async function loadBonusProjection(lmId: string, currentAvg30dPct: number): Promise<BonusProjection | null> {
  const sb = createAdminClient();
  const { data: cfg } = await sb
    .from("compensation_config")
    .select("annual_base_cents, unlock_rules")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!cfg) return null;
  const config = cfg as CompConfig;

  const { data: ovr } = await sb
    .from("compensation_overrides")
    .select("annual_base_cents")
    .eq("lm_id", lmId)
    .maybeSingle();
  const annualBase = (ovr as { annual_base_cents?: number } | null)?.annual_base_cents ?? config.annual_base_cents;

  // Sort tiers descending and pick the first whose threshold the LM clears
  const ladder = [...config.unlock_rules.by_monthly_avg_pct].sort((a, b) => b.min_avg_pct - a.min_avg_pct);
  const safePct = Math.max(0, currentAvg30dPct);
  const tier = ladder.find((r) => safePct >= r.min_avg_pct) ?? ladder[ladder.length - 1];
  // Find the next tier above the current one for "pct_to_next_tier"
  const nextTier = ladder.find((r) => r.min_avg_pct > safePct) ?? null;

  const annualProjected = Math.round(annualBase * tier.share);
  return {
    annual_base_cents: annualBase,
    current_avg_pct: safePct,
    unlock_share: tier.share,
    unlock_label: tier.label,
    projected_annual_cents: annualProjected,
    projected_quarter_cents: Math.round(annualProjected / 4),
    projected_month_cents: Math.round(annualProjected / 12),
    next_tier: nextTier
      ? { ...nextTier, min_avg_pct: nextTier.min_avg_pct }
      : null,
    pct_to_next_tier: nextTier ? Math.max(0, nextTier.min_avg_pct - safePct) : null,
  };
}

export function formatCents(cents: number): string {
  const dollars = cents / 100;
  return dollars.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
