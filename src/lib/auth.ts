import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Role = "lm" | "dm" | "super_admin";

export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const domain = process.env.ALLOWED_EMAIL_DOMAIN || "brodierec.com";
  return email.toLowerCase().endsWith("@" + domain.toLowerCase());
}

export async function getCurrentUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  return { user, profile: profile as Profile | null };
}

export async function requireUser() {
  const ctx = await getCurrentUser();
  if (!ctx?.user) redirect("/login");
  return ctx;
}

export async function requireRole(roles: Role[]) {
  const ctx = await requireUser();
  if (!ctx.profile || !roles.includes(ctx.profile.role as Role)) {
    redirect("/");
  }
  return ctx;
}

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  slack_user_id: string | null;
  opt_in_leaderboard: boolean;
  tour_completed_at: string | null;
  personal_goal_pct: number | null;
};
