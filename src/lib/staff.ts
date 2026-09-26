import { createAdminClient } from "@/lib/supabase/admin";
import { sourceClient, sourceConfigured } from "@/lib/source-apps/clients";
import { normName } from "@/lib/names";

// Who counts as staff, keyed by normalised name and valued with what to show on
// hover ("Scorekeeper · Markham"). Two sources:
//   - the training site's roster, active or invited;
//   - every League Health user. Sign-in is gated to brodierec.com, so anyone
//     with a profile here is staff — including operations managers who never
//     go through training (Ryan Hall, Alex Olay).
//
// Matched by NAME, not email: the discount feed is public, so player emails
// stay out of it, and managers sign in with a brodierec.com address while they
// register to play with a personal one. A person is keyed by their full name
// and by first + last. Two looser keys are added only where exactly one staff
// member produces them, so neither can tag the wrong one of two:
//   - first name + surname initial, for a profile like "Arya K";
//   - a standard nickname swapped for the formal name or back, so the League
//     Health user "Alex Olay" matches the player "Alexander Olay".

// Short form -> the formal names it stands for. Deliberately the common,
// unambiguous ones; a loose prefix rule would tie "Chris Singh" to "Christina
// Singh", and surnames like Singh and Patel are shared by many players.
const NICKNAMES: Record<string, string[]> = {
  alex: ["alexander", "alexandra"], andy: ["andrew"], drew: ["andrew"], ben: ["benjamin"],
  bill: ["william"], will: ["william"], bob: ["robert"], rob: ["robert"], robbie: ["robert"],
  chris: ["christopher"], dan: ["daniel"], danny: ["daniel"], dave: ["david"], ed: ["edward"],
  eddie: ["edward"], greg: ["gregory"], jake: ["jacob"], jim: ["james"], jimmy: ["james"],
  jeff: ["jeffrey"], joe: ["joseph"], joey: ["joseph"], jon: ["jonathan"], josh: ["joshua"],
  ken: ["kenneth"], matt: ["matthew"], mike: ["michael"], nate: ["nathan", "nathaniel"],
  nick: ["nicholas", "nicolas"], pat: ["patrick"], rick: ["richard"], rich: ["richard"],
  sam: ["samuel"], steve: ["steven", "stephen"], tim: ["timothy"], tom: ["thomas"],
  tommy: ["thomas"], tony: ["anthony"], zach: ["zachary"], zack: ["zachary"],
  kate: ["katherine", "catherine"], katie: ["katherine", "catherine"], liz: ["elizabeth"],
  jen: ["jennifer"], jenny: ["jennifer"], meg: ["megan", "margaret"], vicky: ["victoria"],
};
const FORMAL_TO_NICK = new Map<string, string[]>();
for (const [nick, formals] of Object.entries(NICKNAMES)) {
  for (const f of formals) FORMAL_TO_NICK.set(f, [...(FORMAL_TO_NICK.get(f) ?? []), nick]);
}

const LH_ROLE: Record<string, string> = {
  lm: "League Manager", dm: "District Manager", operations_manager: "Operations Manager", super_admin: "Admin",
};

type Person = { names: string[]; label: string };

async function trainingStaff(): Promise<Person[]> {
  if (!sourceConfigured("training")) return [];
  try {
    const sb = sourceClient("training")!;
    const [users, locs] = await Promise.all([
      sb.from("users")
        .select("full_name, first_name, last_name, location_id, primary_role:roles!users_primary_role_id_fkey ( name )")
        .in("status", ["active", "invited"]),
      sb.from("locations").select("id, name"),
    ]);
    if (users.error) return [];
    type U = {
      full_name: string | null; first_name: string | null; last_name: string | null; location_id: string | null;
      primary_role: { name: string } | { name: string }[] | null;
    };
    const locName = new Map(((locs.data ?? []) as { id: string; name: string }[]).map((l) => [l.id, l.name]));
    return ((users.data ?? []) as U[]).map((u) => {
      const role = (Array.isArray(u.primary_role) ? u.primary_role[0] : u.primary_role)?.name ?? "Staff";
      const where = u.location_id ? locName.get(u.location_id) : undefined;
      return {
        names: [u.full_name ?? "", [u.first_name, u.last_name].filter(Boolean).join(" ")],
        label: where ? `${role} · ${where}` : role,
      };
    });
  } catch {
    return [];
  }
}

async function leagueHealthUsers(): Promise<Person[]> {
  try {
    const { data, error } = await createAdminClient().from("profiles").select("full_name, email, role");
    if (error) return [];
    return ((data ?? []) as { full_name: string | null; email: string; role: string }[]).map((p) => ({
      // A profile without a name still has "first.last@" as its address.
      names: [p.full_name || p.email.split("@")[0].replace(/[._-]+/g, " ")],
      label: `${LH_ROLE[p.role] ?? "Staff"} (League Health)`,
    }));
  } catch {
    return [];
  }
}

export async function loadStaff(): Promise<Record<string, string> | null> {
  const [training, lh] = await Promise.all([trainingStaff(), leagueHealthUsers()]);
  // Training first, so its role-and-venue label wins for someone in both.
  const people = [...training, ...lh];
  if (people.length === 0) return null;

  const out: Record<string, string> = {};
  for (const p of people) {
    for (const n of p.names) {
      const k = normName(n);
      if (k && !out[k]) out[k] = p.label;
    }
  }

  // Looser keys, kept only where one person (by full name) produces them.
  const loose = new Map<string, Map<string, string>>();
  const offer = (key: string, who: string, label: string) => {
    if (!loose.has(key)) loose.set(key, new Map());
    // First label wins, so training's role-and-venue beats League Health's.
    if (!loose.get(key)!.has(who)) loose.get(key)!.set(who, label);
  };
  for (const p of people) {
    const full = normName(p.names.find((n) => normName(n)) ?? "");
    const parts = full.split(" ");
    if (parts.length < 2) continue;
    const first = parts[0], last = parts[parts.length - 1];
    if (last.length > 1) offer(`${first} ${last[0]}`, full, p.label);
    for (const alt of [...(NICKNAMES[first] ?? []), ...(FORMAL_TO_NICK.get(first) ?? [])]) {
      offer(`${alt} ${last}`, full, p.label);
    }
  }
  for (const [key, who] of loose) {
    if (who.size === 1 && !out[key]) out[key] = [...who.values()][0];
  }
  return out;
}
