// Roles for the Users admin. League Health has three, no per-location scoping.
export type UserRole = "super_admin" | "dm" | "lm";

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: "Super Admin",
  dm: "District Manager",
  lm: "League Manager",
};

// Display order for role groups (most senior first).
export const ROLE_ORDER: UserRole[] = ["super_admin", "dm", "lm"];

export type UserStatus = "active" | "invited" | "inactive";
