import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Role = "lm" | "dm" | "operations_manager" | "super_admin";

// Roles allowed to add/edit users. dm was demoted from full admin; only
// super_admin now sees the whole Settings hub.
export const USER_MANAGER_ROLES: Role[] = ["dm", "operations_manager", "super_admin"];
export function canManageUsers(role: string | null | undefined): boolean {
  return !!role && (USER_MANAGER_ROLES as string[]).includes(role);
}

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

// Users who are not yet approved land on the Ops Hub's shared access-denied
// page, which renders a Request Access button that pings Amy + Sohaib in
// Slack. Matches how the other gated Brodie apps handle it.
const HUB_ACCESS_DENIED_URL =
  "https://brodie-ops-hub.vercel.app/access-denied?app=league-health";

export async function requireUser() {
  const ctx = await getCurrentUser();
  if (!ctx?.user) redirect("/login");
  // No profile yet, or not approved: send them somewhere they can ask.
  if (!ctx.profile || ctx.profile.active === false) redirect(HUB_ACCESS_DENIED_URL);
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
  active: boolean;
  requested_at: string | null;
};
