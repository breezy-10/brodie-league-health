// Roles for the Users admin. No per-location scoping.
export type UserRole = "super_admin" | "dm" | "operations_manager" | "lm";

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: "Super Admin",
  dm: "District Manager",
  operations_manager: "Operations Manager",
  lm: "League Manager",
};

// Display order for role groups (most senior first).
export const ROLE_ORDER: UserRole[] = ["super_admin", "dm", "operations_manager", "lm"];

export type UserStatus = "active" | "invited" | "inactive";
