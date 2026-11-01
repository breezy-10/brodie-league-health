import { createAdminClient } from "@/lib/supabase/admin";
import { sourceClient, sourceConfigured } from "@/lib/source-apps/clients";
import { fetchDirectory, normEmail, normName, type Directory } from "@/lib/directory";
import { sameLocation } from "@/lib/location-match";

/**
 * The `league_managers` scoring roster.
 *
 * Source: brodie-districts' directory (src/lib/directory.ts), so a manager
 * change is entered once, in districts. Each run:
 *   - Every league manager districts names for an active location now gets a
 *     row, matched by email (lowercase). A name districts has no email for is
 *     matched to an existing roster row or League Health sign-in with the
 *     exact same full name; anything else (placeholders like "Atlanta LM")
 *     goes in `noAccount` and gets no row.
 *   - Their locations are every location districts names them for:
 *     `location_names` + `league_ids` (the ops league id), primary first.
 *     `location_name` stays the primary one for display: the current one when
 *     it is still theirs, else the first alphabetically.
 *   - `district` is their district managers' names (those with an email,
 *     most locations first).
 *   - A row whose person districts doesn't list is left as it is, active, and
 *     reported in `notInDistricts`: staff who aren't on a districts roster
 *     (Destin Gross, Ekjot Sandhu and Shane McNabb in Nov 2026) are still at
 *     Brodie, so not being listed is no reason to stop scoring them. Rows are
 *     never deleted, and ids never change: rows are updated in place by id.
 *   - `hired_at` is filled from the Training app's users table by email.
 *   - Super admins never get an active row (unchanged rule).
 *
 * DIRECTORY_SYNC=apply writes it. Anything else is report only: the directory
 * diff is computed and logged, and the old CRM copy (syncRosterFromCrm) keeps
 * the roster as it was. With the switch on and districts unreachable, the run
 * is skipped: a missing directory never reads as "everyone left".
 */

export interface RosterSyncResult {
  ok: boolean;
  error?: string;
  dryRun: boolean;
  /** Active league managers after the run. */
  synced: number;
  created: { name: string; email: string; locations: string[] }[];
  reactivated: { name: string; email: string }[];
  deactivated: { name: string; email: string; location: string | null }[];
  /** Active rows districts doesn't list: kept as they are, for someone to check. */
  notInDistricts: { name: string; email: string; location: string | null }[];
  /** Location changes, primary first on both sides. */
  locations: { name: string; email: string; before: string[]; after: string[] }[];
  districts: { name: string; from: string | null; to: string | null }[];
  hiredAt: { name: string; hiredAt: string }[];
  /** Matched by exact name because districts has no email for them. */
  matchedByName: { name: string; email: string }[];
  /** League managers in districts with no email and no match here. */
  noAccount: { name: string; locations: string[] }[];
  /** Named as league managers in districts but super admins here. */
  superAdmins: string[];
}

type RosterRow = {
  id: string;
  email: string;
  full_name: string | null;
  location_name: string | null;
  location_names?: string[] | null;
  league_ids?: string[] | null;
  district: string | null;
  active: boolean;
  hired_at: string | null;
  profile_id: string | null;
};

type Want = {
  email: string;
  name: string;
  /** Directory locations, by id. */
  locs: Map<string, string>;
  dms: Map<string, { name: string; email: string | null; n: number }>;
  byName: boolean;
};

/** Supabase returns at most 1000 rows per select, silently. */
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

/** Training's hire dates by lowercase email; empty when Training isn't connected. */
async function trainingHireDates(): Promise<Map<string, string>> {
  const training = sourceClient("training");
  if (!training) return new Map();
  try {
    const rows = await fetchAll<{ email: string | null; hired_at: string | null }>((a, b) =>
      training.from("users").select("email, hired_at").not("hired_at", "is", null).order("id").range(a, b),
    );
    const out = new Map<string, string>();
    for (const r of rows) if (r.email && r.hired_at) out.set(normEmail(r.email), r.hired_at.slice(0, 10));
    return out;
  } catch (e) {
    console.error("[roster] training hire dates unreadable", e);
    return new Map();
  }
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export async function syncRosterFromDirectory(
  opts: { dryRun?: boolean; directory?: Directory | null } = {},
): Promise<RosterSyncResult> {
  const dryRun = opts.dryRun === true;
  const out: RosterSyncResult = {
    ok: false, dryRun, synced: 0, created: [], reactivated: [], deactivated: [], notInDistricts: [], locations: [],
    districts: [], hiredAt: [], matchedByName: [], noAccount: [], superAdmins: [],
  };
  const directory = opts.directory !== undefined ? opts.directory : await fetchDirectory();
  if (!directory) return { ...out, error: "Districts directory unreachable or not configured: skipped." };

  const sb = createAdminClient();
  // `*` so the run still reads before migration 0023 adds location_names / league_ids.
  const [{ data: rosterData, error: rErr }, { data: profData, error: pErr }] = await Promise.all([
    sb.from("league_managers").select("*"),
    sb.from("profiles").select("id, email, full_name, role"),
  ]);
  if (rErr || !rosterData) return { ...out, error: `Could not read the roster: ${rErr?.message ?? "no rows"}` };
  if (pErr || !profData) return { ...out, error: `Could not read profiles: ${pErr?.message ?? "no rows"}` };
  const roster = rosterData as RosterRow[];
  const profiles = profData as { id: string; email: string; full_name: string | null; role: string }[];
  const superAdminEmails = new Set(profiles.filter((p) => p.role === "super_admin").map((p) => normEmail(p.email)));

  const rowByEmail = new Map(roster.map((r) => [normEmail(r.email), r]));
  // Exact-name fallbacks, used only for people districts has no email for.
  // A name shared by two rows (or two sign-ins) matches neither.
  const uniqueBy = <T>(items: T[], key: (t: T) => string) => {
    const m = new Map<string, T | null>();
    for (const t of items) {
      const k = key(t);
      if (k) m.set(k, m.has(k) ? null : t);
    }
    return m;
  };
  const realRows = roster.filter((r) => !r.email.startsWith("_merged_"));
  const activeRowByName = uniqueBy(realRows.filter((r) => r.active), (r) => normName(r.full_name));
  const rowByName = uniqueBy(realRows, (r) => normName(r.full_name));
  const profileByName = uniqueBy(profiles, (p) => normName(p.full_name));

  // 1. Who districts names, and for which active locations.
  const want = new Map<string, Want>(); // email -> wanted row
  const noAccount = new Map<string, Set<string>>();
  for (const loc of directory.locations) {
    if (!loc.is_active) continue;
    for (const person of loc.league_managers) {
      let email = normEmail(person.email);
      let byName = false;
      if (!email) {
        const n = normName(person.name);
        const row = activeRowByName.get(n) ?? rowByName.get(n);
        const prof = profileByName.get(n);
        email = row ? normEmail(row.email) : prof ? normEmail(prof.email) : "";
        byName = !!email;
      }
      if (!email) {
        (noAccount.get(person.name) ?? noAccount.set(person.name, new Set()).get(person.name)!).add(loc.name);
        continue;
      }
      const w = want.get(email) ?? { email, name: person.name.trim(), locs: new Map(), dms: new Map(), byName };
      w.locs.set(loc.id, loc.name);
      for (const dm of loc.district_managers) {
        const k = normEmail(dm.email) || normName(dm.name);
        const cur = w.dms.get(k) ?? { name: dm.name.trim(), email: dm.email, n: 0 };
        cur.n += 1;
        w.dms.set(k, cur);
      }
      want.set(email, w);
    }
  }
  out.noAccount = [...noAccount].map(([name, ls]) => ({ name, locations: [...ls].sort() })).sort((a, b) => a.name.localeCompare(b.name));

  for (const email of [...want.keys()]) {
    if (superAdminEmails.has(email)) {
      out.superAdmins.push(want.get(email)!.name);
      want.delete(email);
    }
  }
  if (want.size === 0) return { ...out, error: "Districts names no league managers with an email: skipped." };

  // Most of the roster missing from districts is far more likely a districts
  // problem than real.
  const activeNow = roster.filter((r) => r.active && !superAdminEmails.has(normEmail(r.email)));
  const leaving = activeNow.filter((r) => !want.has(normEmail(r.email)));
  if (activeNow.length >= 6 && leaving.length > activeNow.length / 2) {
    return { ...out, error: `Districts lists only ${activeNow.length - leaving.length} of ${activeNow.length} active league managers: skipped. Check the directory.` };
  }

  const hires = await trainingHireDates();
  const now = new Date().toISOString();

  // 2. Upserts, by id for existing rows so ids never change.
  for (const w of want.values()) {
    const row = rowByEmail.get(w.email);
    const locs = [...w.locs].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
    const keep = row?.location_name ? locs.find((l) => sameLocation(l.name, row.location_name!)) : undefined;
    const ordered = keep ? [keep, ...locs.filter((l) => l !== keep)] : locs;
    const names = ordered.map((l) => l.name);
    const ids = ordered.map((l) => l.id);
    const dmList = [...w.dms.values()];
    const withEmail = dmList.filter((d) => d.email);
    const district = (withEmail.length ? withEmail : dmList)
      .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
      .map((d) => d.name)
      .join(", ") || null;
    const hiredAt = hires.get(w.email) ?? null;
    if (w.byName) out.matchedByName.push({ name: w.name, email: w.email });

    if (!row) {
      out.created.push({ name: w.name, email: w.email, locations: names });
      if (hiredAt) out.hiredAt.push({ name: w.name, hiredAt });
      if (!dryRun) {
        const { error } = await sb.from("league_managers").insert({
          email: w.email, full_name: w.name, location_name: names[0] ?? null, location_names: names,
          league_ids: ids, district, active: true, hired_at: hiredAt, updated_at: now,
        });
        if (error) return { ...out, error: `Could not add ${w.name}: ${error.message}` };
      }
      continue;
    }

    const patch: Record<string, unknown> = {};
    const label = row.full_name ?? w.name;
    if (!row.active) {
      patch.active = true;
      out.reactivated.push({ name: label, email: w.email });
    }
    // Someone matched by name keeps the name this app has for them.
    if (!w.byName && row.full_name !== w.name) patch.full_name = w.name;
    const before = row.location_names ?? (row.location_name ? [row.location_name] : []);
    if (row.location_name !== (names[0] ?? null) || !sameList(row.location_names ?? [], names) || !sameList(row.league_ids ?? [], ids)) {
      patch.location_name = names[0] ?? null;
      patch.location_names = names;
      patch.league_ids = ids;
      // Filling the arrays for an unchanged location isn't news.
      if (!sameList(before, names)) out.locations.push({ name: label, email: w.email, before, after: names });
    }
    if (row.district !== district) {
      patch.district = district;
      out.districts.push({ name: label, from: row.district, to: district });
    }
    if (hiredAt && row.hired_at !== hiredAt) {
      patch.hired_at = hiredAt;
      out.hiredAt.push({ name: label, hiredAt });
    }
    if (Object.keys(patch).length === 0 || dryRun) continue;
    patch.updated_at = now;
    const { error } = await sb.from("league_managers").update(patch).eq("id", row.id);
    if (error) return { ...out, error: `Could not update ${label}: ${error.message}` };
  }

  // 3. Super admins are switched off (they never score, whatever districts
  // says). Anyone else districts doesn't list keeps their row as it is.
  for (const r of roster.filter((r) => r.active && !want.has(normEmail(r.email)) && !superAdminEmails.has(normEmail(r.email)))) {
    out.notInDistricts.push({ name: r.full_name ?? r.email, email: r.email, location: r.location_name });
  }
  const off = roster.filter((r) => r.active && superAdminEmails.has(normEmail(r.email)));
  for (const r of off) {
    out.deactivated.push({ name: r.full_name ?? r.email, email: r.email, location: r.location_name });
    if (dryRun) continue;
    const { error } = await sb.from("league_managers").update({ active: false, updated_at: now }).eq("id", r.id);
    if (error) return { ...out, error: `Could not deactivate ${r.full_name ?? r.email}: ${error.message}` };
  }

  if (!dryRun) await linkProfiles(sb);
  out.synced = want.size;
  return { ...out, ok: true };
}

/** One line per change, for logs and the dry-run script. */
export function describeRosterSync(r: RosterSyncResult): string {
  const lines = [
    `${r.dryRun ? "Report only" : "Applied"}: ${r.ok ? `${r.synced} active league managers` : `FAILED ${r.error}`}`,
    ...r.created.map((c) => `+ add ${c.name} <${c.email}>: ${c.locations.join(", ")}`),
    ...r.reactivated.map((c) => `+ reactivate ${c.name} <${c.email}>`),
    ...r.deactivated.map((c) => `- deactivate ${c.name} <${c.email}> (was ${c.location ?? "no location"})`),
    ...r.notInDistricts.map((c) => `? not in districts, left as is: ${c.name} <${c.email}> (${c.location ?? "no location"})`),
    ...r.locations.map((c) => `~ ${c.name}: ${c.before.join(", ") || "no location"} -> ${c.after.join(", ") || "no location"}`),
    ...r.districts.map((c) => `~ ${c.name}: district manager ${c.from ?? "none"} -> ${c.to ?? "none"}`),
    ...r.hiredAt.map((c) => `~ ${c.name}: hired ${c.hiredAt} (from Training)`),
    ...r.matchedByName.map((c) => `? ${c.name}: no email in districts, matched by name to <${c.email}>`),
    ...r.noAccount.map((c) => `? no account: ${c.name} (${c.locations.join(", ")})`),
    ...r.superAdmins.map((n) => `? ${n} is a super admin here, so not on the roster`),
  ];
  return lines.join("\n");
}

// Link profile_id for any roster row whose email matches a sign-in, so "you
// logged in, you see your page" needs nobody to wire the FK. Best effort.
async function linkProfiles(sb: ReturnType<typeof createAdminClient>): Promise<void> {
  try {
    const { data: profiles } = await sb.from("profiles").select("id, email");
    const profileByEmail = new Map(
      ((profiles ?? []) as Array<{ id: string; email: string }>).map((p) => [p.email.toLowerCase(), p.id]),
    );
    const { data: unlinked } = await sb.from("league_managers").select("id, email").is("profile_id", null);
    for (const lm of (unlinked ?? []) as Array<{ id: string; email: string }>) {
      const pid = profileByEmail.get(lm.email.toLowerCase());
      if (!pid) continue;
      await sb.from("league_managers").update({ profile_id: pid }).eq("id", lm.id);
    }
  } catch {
    // never block the sync on it
  }
}

/**
 * Entry point for the daily sync and My Day's self-heal. With
 * DIRECTORY_SYNC=apply the roster comes from districts; otherwise the
 * directory diff is logged and the CRM copy runs as before.
 */
export async function syncRoster(): Promise<{ synced: number; error?: string; directory?: RosterSyncResult }> {
  const apply = process.env.DIRECTORY_SYNC === "apply";
  const directory = await syncRosterFromDirectory({ dryRun: !apply });
  console.log(`[roster] directory sync\n${describeRosterSync(directory)}`);
  if (apply) return { synced: directory.synced, error: directory.error, directory };
  const crm = await syncRosterFromCrm();
  return { ...crm, directory };
}

/**
 * The old roster source, used until DIRECTORY_SYNC=apply: brodie-crm.managers,
 * upserted into league_managers by email. Each league manager gets only their
 * FIRST assigned location; the district manager via reports_to becomes
 * `district`. Remove once the directory sync is live.
 */
export async function syncRosterFromCrm(): Promise<{ synced: number; error?: string }> {
  if (!sourceConfigured("crm")) return { synced: 0, error: "CRM not configured" };
  const crm = sourceClient("crm")!;
  const sb = createAdminClient();

  const { data: managers, error } = await crm
    .from("managers")
    .select("id, email, name, role, assigned_locations, reports_to, active");
  if (error) return { synced: 0, error: error.message };

  const { data: locs } = await crm.from("locations").select("id, name");
  const locMap = new Map((locs ?? []).map((l: { id: string; name: string }) => [l.id, l.name]));

  type CrmManager = {
    id: string;
    email: string;
    name: string;
    role: string;
    assigned_locations: string[] | null;
    reports_to: string | null;
    active: boolean;
  };

  const all = (managers ?? []) as CrmManager[];
  const byId = new Map(all.map((m) => [m.id, m]));

  // Super admins never get their league_managers row re-activated by sync,
  // even if the CRM still lists them as a league manager.
  const { data: superAdmins } = await sb
    .from("profiles")
    .select("email")
    .eq("role", "super_admin");
  const superAdminEmails = new Set(
    ((superAdmins ?? []) as Array<{ email: string }>).map((p) => p.email.toLowerCase())
  );

  // District managers are admins, not scored league managers.
  const rows = all
    .filter((m) => m.role === "league_manager")
    .filter((m) => !superAdminEmails.has(m.email.toLowerCase()))
    .map((m) => {
      const firstLoc = (m.assigned_locations ?? [])[0];
      const dm = m.reports_to ? byId.get(m.reports_to) : undefined;
      return {
        email: m.email.toLowerCase(),
        full_name: m.name,
        location_name: firstLoc ? locMap.get(firstLoc) ?? firstLoc : null,
        district: dm?.name ?? null,
        active: m.active ?? true,
        updated_at: new Date().toISOString(),
      };
    });

  if (!rows.length) return { synced: 0 };

  const { error: upErr } = await sb.from("league_managers").upsert(rows, { onConflict: "email" });
  if (upErr) return { synced: 0, error: upErr.message };

  // Belt and braces: switch off any super admin row still active from before.
  if (superAdminEmails.size > 0) {
    await sb
      .from("league_managers")
      .update({ active: false, updated_at: new Date().toISOString() })
      .in("email", Array.from(superAdminEmails))
      .eq("active", true);
  }

  await linkProfiles(sb);
  return { synced: rows.length };
}
