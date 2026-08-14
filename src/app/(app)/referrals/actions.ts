"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// Changing the terms is a money decision, so it matches the apps/metrics write
// policy: dm and super_admin only. The RLS on referral_rates enforces the same
// thing; this is the gate that gives a usable error instead of a silent no-op.
const EDITOR_ROLES = ["dm", "super_admin"];

const MAX_AMOUNT = 1000;

function clean(value: number, label: string): number | { error: string } {
  if (!Number.isFinite(value)) return { error: `${label} must be a number.` };
  if (value < 0) return { error: `${label} can't be negative.` };
  if (value > MAX_AMOUNT) return { error: `${label} looks wrong — cap is $${MAX_AMOUNT}.` };
  return Math.round(value * 100) / 100;
}

export async function saveReferralRates(input: {
  season: string;
  newAthletePayment: number;
  returningAthletePayment: number;
  registrantDiscount: number;
}): Promise<{ ok: true } | { error: string }> {
  const ctx = await getCurrentUser();
  const role = ctx?.profile?.role;
  if (!role || !EDITOR_ROLES.includes(role)) {
    return { error: "Only a district manager or super admin can change the referral terms." };
  }
  const season = input.season.trim();
  if (!season) return { error: "Missing season." };

  const values = [
    clean(input.newAthletePayment, "New athlete payment"),
    clean(input.returningAthletePayment, "Returning athlete payment"),
    clean(input.registrantDiscount, "Registrant discount"),
  ];
  const bad = values.find((v) => typeof v === "object");
  if (bad && typeof bad === "object") return bad;
  const [newAthletePayment, returningAthletePayment, registrantDiscount] = values as number[];

  const admin = createAdminClient();
  const { error } = await admin.from("referral_rates").upsert({
    season,
    new_athlete_payment: newAthletePayment,
    returning_athlete_payment: returningAthletePayment,
    registrant_discount: registrantDiscount,
    updated_at: new Date().toISOString(),
    updated_by: ctx?.user?.id ?? null,
  }, { onConflict: "season" });

  if (error) return { error: error.message };

  revalidatePath("/referrals");
  return { ok: true };
}
