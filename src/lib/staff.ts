import { sourceClient, sourceConfigured } from "@/lib/source-apps/clients";
import { normName } from "@/lib/names";

// Everyone on the training site's roster — active or invited — keyed by
// normalised name, valued with what to show on hover ("Scorekeeper · Markham").
//
// Matched by NAME, not email: the discount feed is public, so player emails
// stay out of it, and managers train under a brodierec.com address while they
// register to play with a personal one — name catches those where email can't.
// A training profile is keyed by both its full name and first + last, since
// the two are edited separately there. Checked against Fall '26 + Winter '27:
// name matching finds 63 discounted staff registrations, email 49, and misses
// 4 whose player profile spells their name differently from their training one.
export async function loadStaff(): Promise<Record<string, string> | null> {
  if (!sourceConfigured("training")) return null;
  try {
    const sb = sourceClient("training")!;
    const [users, locs] = await Promise.all([
      sb.from("users")
        .select("full_name, first_name, last_name, location_id, primary_role:roles!users_primary_role_id_fkey ( name )")
        .in("status", ["active", "invited"]),
      sb.from("locations").select("id, name"),
    ]);
    if (users.error) return null;
    type U = {
      full_name: string | null; first_name: string | null; last_name: string | null; location_id: string | null;
      primary_role: { name: string } | { name: string }[] | null;
    };
    const locName = new Map(((locs.data ?? []) as { id: string; name: string }[]).map((l) => [l.id, l.name]));
    const out: Record<string, string> = {};
    // "Arya K" on a player profile is "Arya Karbakhsh" in training. First name
    // plus last initial is collected per person and only used where exactly one
    // staff member fits, so it can't tag the wrong one of two.
    const initials = new Map<string, string[]>();
    for (const u of (users.data ?? []) as U[]) {
      const role = (Array.isArray(u.primary_role) ? u.primary_role[0] : u.primary_role)?.name ?? "Staff";
      const where = u.location_id ? locName.get(u.location_id) : undefined;
      const label = where ? `${role} · ${where}` : role;
      for (const n of [u.full_name, [u.first_name, u.last_name].filter(Boolean).join(" ")]) {
        const k = normName(n);
        if (k && !out[k]) out[k] = label;
      }
      const parts = normName(u.full_name || [u.first_name, u.last_name].filter(Boolean).join(" ")).split(" ");
      if (parts.length >= 2 && parts[parts.length - 1].length > 1) {
        const k = `${parts[0]} ${parts[parts.length - 1][0]}`;
        initials.set(k, [...(initials.get(k) ?? []), label]);
      }
    }
    for (const [k, labels] of initials) if (labels.length === 1 && !out[k]) out[k] = labels[0];
    return out;
  } catch {
    return null;
  }
}
