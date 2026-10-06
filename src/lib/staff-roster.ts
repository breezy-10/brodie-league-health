import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sourceClient } from "@/lib/source-apps/clients";

// Staff for the Staff performance page: everyone in the Training app, with
// their primary role and the venues they cover, plus their latest rating here.
//
// Training is read live rather than copied, so a new hire, a role change or a
// move between venues shows up without a sync. Venues follow Training's own
// rule (lib/location-scope.ts there): user_locations where a person has rows,
// users.location_id as the fallback for anyone who has none.

export type StaffStatus = "active" | "invited" | "inactive";

export interface StaffMember {
  id: string;
  name: string;
  email: string;
  role: string;
  roleSlug: string;
  status: StaffStatus;
  locations: string[];
  rating: number | null;
  ratedBy: string | null;
  ratedAt: string | null;
}

// Most senior first; anything Training adds later sorts after these by name.
const ROLE_ORDER = ["admin", "people", "dm", "lm", "ahs", "aes", "scorekeeper"];
export function roleRank(slug: string): number {
  const i = ROLE_ORDER.indexOf(slug);
  return i === -1 ? ROLE_ORDER.length : i;
}

// Supabase returns at most 1000 rows per select, silently.
async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if ((data ?? []).length < 1000) return out;
  }
}

type TrainingUser = {
  id: string;
  email: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  status: string | null;
  location_id: string | null;
  primary_role: { slug: string; name: string } | { slug: string; name: string }[] | null;
};

/**
 * `staff` is null when Training can't be read. `ratingsReady` is false when the
 * ratings table isn't there yet, so the page can say so instead of failing.
 */
export async function loadStaffRoster(): Promise<{ staff: StaffMember[] | null; ratingsReady: boolean }> {
  const training = sourceClient("training");
  if (!training) return { staff: null, ratingsReady: false };

  let users: TrainingUser[], links: { user_id: string; location_id: string }[], locs: { id: string; name: string }[];
  try {
    [users, links, locs] = await Promise.all([
      fetchAll<TrainingUser>((a, b) => training
        .from("users")
        .select("id, email, full_name, first_name, last_name, status, location_id, primary_role:roles!users_primary_role_id_fkey ( slug, name )")
        .order("id").range(a, b)),
      fetchAll<{ user_id: string; location_id: string }>((a, b) => training
        .from("user_locations").select("user_id, location_id").order("user_id").range(a, b)),
      fetchAll<{ id: string; name: string }>((a, b) => training
        .from("locations").select("id, name").order("id").range(a, b)),
    ]);
  } catch (e) {
    console.error("[staff] training read failed", e);
    return { staff: null, ratingsReady: false };
  }

  const locName = new Map(locs.map((l) => [l.id, l.name]));
  const covered = new Map<string, Set<string>>();
  for (const l of links) {
    if (!covered.has(l.user_id)) covered.set(l.user_id, new Set());
    covered.get(l.user_id)!.add(l.location_id);
  }

  const admin = createAdminClient();
  const { data: latest, error: ratingsError } = await admin
    .from("staff_ratings_latest")
    .select("training_user_id, rating, rated_by_name, created_at");
  const ratings = new Map(
    ((latest ?? []) as { training_user_id: string; rating: number; rated_by_name: string | null; created_at: string }[])
      .map((r) => [r.training_user_id, r]),
  );

  const staff = users.map((u): StaffMember => {
    const role = Array.isArray(u.primary_role) ? u.primary_role[0] : u.primary_role;
    const venueIds = covered.get(u.id)?.size ? [...covered.get(u.id)!] : u.location_id ? [u.location_id] : [];
    const status: StaffStatus = u.status === "inactive" ? "inactive" : u.status === "invited" ? "invited" : "active";
    const r = ratings.get(u.id);
    return {
      id: u.id,
      name: u.full_name?.trim() || [u.first_name, u.last_name].filter(Boolean).join(" ").trim() || u.email,
      email: u.email,
      role: role?.name ?? "No role",
      roleSlug: role?.slug ?? "",
      status,
      locations: venueIds.map((id) => locName.get(id)).filter((n): n is string => !!n).sort((a, b) => a.localeCompare(b)),
      rating: r?.rating ?? null,
      ratedBy: r?.rated_by_name ?? null,
      ratedAt: r?.created_at ?? null,
    };
  });

  staff.sort((a, b) => roleRank(a.roleSlug) - roleRank(b.roleSlug) || a.role.localeCompare(b.role) || a.name.localeCompare(b.name));
  return { staff, ratingsReady: !ratingsError };
}
