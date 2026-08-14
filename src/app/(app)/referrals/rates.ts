import { createAdminClient } from "@/lib/supabase/admin";

// What the referrer is paid and what the referred athlete gets off their
// registration, for one season. A season with no stored row uses these
// defaults, which are the terms the programme launched with.
export type ReferralRates = {
  new_athlete_payment: number;
  returning_athlete_payment: number;
  registrant_discount: number;
  updated_at: string | null;
  /** false when no row is stored for this season and the defaults are in play. */
  stored: boolean;
};

// The standing terms: $25 to the referrer for a new athlete, $5 for a
// run-it-back, and $25 off the new athlete's first registration. A season that
// ran different terms carries its own row and is unaffected by these — Fall '26
// is on $50 / $5 / $20, for instance.
export const DEFAULT_RATES: ReferralRates = {
  new_athlete_payment: 25,
  returning_athlete_payment: 5,
  registrant_discount: 25,
  updated_at: null,
  stored: false,
};

export async function loadReferralRates(season: string): Promise<ReferralRates> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("referral_rates")
    .select("new_athlete_payment, returning_athlete_payment, registrant_discount, updated_at")
    .eq("season", season)
    .maybeSingle();
  if (!data) return DEFAULT_RATES;
  const r = data as {
    new_athlete_payment: number | string;
    returning_athlete_payment: number | string;
    registrant_discount: number | string;
    updated_at: string | null;
  };
  return {
    new_athlete_payment: Number(r.new_athlete_payment),
    returning_athlete_payment: Number(r.returning_athlete_payment),
    registrant_discount: Number(r.registrant_discount),
    updated_at: r.updated_at,
    stored: true,
  };
}
