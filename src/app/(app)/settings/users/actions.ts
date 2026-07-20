"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireRole, isAllowedEmail } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UserRole } from "./roles";

// Every mutation here runs through the service-role admin client: the profiles
// RLS only lets a user update their own row, so admin edits/invites must bypass
// it. requireRole is the real gate.

// Replace a user's location assignments with exactly `locations` (deduped).
async function replaceUserLocations(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  locations: string[],
) {
  const clean = [...new Set(locations.map((l) => l.trim()).filter(Boolean))];
  await admin.from("user_locations").delete().eq("user_id", userId);
  if (clean.length) {
    await admin.from("user_locations").insert(clean.map((location_name) => ({ user_id: userId, location_name })));
  }
}

export async function updateUser(input: {
  userId: string;
  fullName?: string;
  role?: UserRole;
  locations?: string[];
}): Promise<{ ok: true } | { error: string }> {
  const { profile } = await requireRole(["dm", "operations_manager", "super_admin"]);
  const actorSuper = profile?.role === "super_admin";
  const admin = createAdminClient();

  // Only a super admin may grant the super_admin role or edit an existing one —
  // stops a dm / operations_manager from escalating themselves or others.
  if (!actorSuper) {
    if (input.role === "super_admin") return { error: "Only a super admin can grant the Super Admin role." };
    const { data: target } = await admin.from("profiles").select("role").eq("id", input.userId).maybeSingle();
    if ((target as { role?: string } | null)?.role === "super_admin") {
      return { error: "Only a super admin can edit a Super Admin." };
    }
  }

  const patch: Record<string, unknown> = {};
  if (input.fullName !== undefined) {
    const n = input.fullName.trim();
    if (!n) return { error: "Name is required." };
    patch.full_name = n;
  }
  if (input.role !== undefined) patch.role = input.role;

  if (Object.keys(patch).length) {
    patch.updated_at = new Date().toISOString();
    const { error } = await admin.from("profiles").update(patch).eq("id", input.userId);
    if (error) return { error: error.message };
    // Keep the auth-user metadata name in sync so future logins keep the name.
    if (input.fullName !== undefined) {
      await admin.auth.admin.updateUserById(input.userId, { user_metadata: { full_name: input.fullName.trim() } });
    }
  }

  if (input.locations !== undefined) await replaceUserLocations(admin, input.userId, input.locations);

  revalidatePath("/settings/users");
  return { ok: true };
}

export async function inviteUser(input: {
  firstName: string;
  lastName?: string;
  email: string;
  role: UserRole;
  locations?: string[];
}): Promise<{ ok: true } | { error: string }> {
  const { profile } = await requireRole(["dm", "operations_manager", "super_admin"]);
  if (input.role === "super_admin" && profile?.role !== "super_admin") {
    return { error: "Only a super admin can invite a Super Admin." };
  }
  const email = input.email.trim().toLowerCase();
  const fullName = `${input.firstName.trim()} ${(input.lastName ?? "").trim()}`.trim();
  if (!email || !fullName) return { error: "Name and email are required." };
  if (!isAllowedEmail(email)) return { error: "Email must be @brodierec.com." };

  const admin = createAdminClient();
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  const origin = host ? `${proto}://${host}` : undefined;

  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName },
    redirectTo: origin ? `${origin}/auth/callback` : undefined,
  });
  if (error) return { error: error.message };

  // The on_auth_user_created trigger inserts the profile row; set the chosen
  // role + name on it. This is independent of the CRM roster entirely.
  if (data.user) {
    await admin.from("profiles")
      .update({ role: input.role, full_name: fullName, updated_at: new Date().toISOString() })
      .eq("id", data.user.id);
    if (input.locations?.length) await replaceUserLocations(admin, data.user.id, input.locations);
  }

  revalidatePath("/settings/users");
  return { ok: true };
}

export async function resendInvite(email: string): Promise<{ ok: true } | { error: string }> {
  try {
    await requireRole(["dm", "operations_manager", "super_admin"]);
    const admin = createAdminClient();
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    const proto = h.get("x-forwarded-proto") ?? "https";
    const origin = host ? `${proto}://${host}` : undefined;
    const { error } = await admin.auth.admin.inviteUserByEmail(email.trim().toLowerCase(), {
      redirectTo: origin ? `${origin}/auth/callback` : undefined,
    });
    if (error) return { error: error.message };
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Unknown error" };
  }
}

// Archive = ban the auth user (blocks sign-in). Reactivate = lift the ban.
// This is the enforcement mechanism AND the persisted state — no schema column.
export async function setUserArchived(userId: string, archived: boolean): Promise<{ ok: true } | { error: string }> {
  try {
    const { user, profile } = await requireRole(["dm", "operations_manager", "super_admin"]);
    if (userId === user.id) return { error: "You can't archive yourself." };
    const admin = createAdminClient();
    if (profile?.role !== "super_admin") {
      const { data: target } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
      if ((target as { role?: string } | null)?.role === "super_admin") {
        return { error: "Only a super admin can archive a Super Admin." };
      }
    }
    const { error } = await admin.auth.admin.updateUserById(userId, {
      ban_duration: archived ? "876000h" : "none",
    });
    if (error) return { error: error.message };
    revalidatePath("/settings/users");
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Unknown error" };
  }
}
