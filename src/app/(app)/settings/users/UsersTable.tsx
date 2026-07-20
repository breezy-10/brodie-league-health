"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { inviteUser } from "./actions";
import { EditUser } from "./EditUser";
import { LocationMultiSelect } from "./LocationMultiSelect";
import { ROLE_LABELS, ROLE_ORDER, type UserRole, type UserStatus } from "./roles";

export interface UserListRow {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  location: string | null;
  locations: string[];
}

const INPUT =
  "w-full rounded-lg border border-glass-border bg-glass-surface px-3 py-2 text-sm text-glass-text placeholder:text-glass-text-tertiary focus:outline-none focus:border-glass-gold transition";
const BTN_PRIMARY =
  "rounded-lg bg-glass-gold text-black font-semibold text-sm px-4 py-2 hover:brightness-110 disabled:opacity-50 transition shrink-0";
const BTN_SECONDARY =
  "rounded-lg border border-glass-border bg-glass-surface text-sm px-3.5 py-2 hover:bg-glass-surface-hover transition";

const STATUS_GROUPS: { key: UserStatus; label: string; dot: string }[] = [
  { key: "active", label: "Active", dot: "rgb(74,222,128)" },
  { key: "invited", label: "Invited", dot: "var(--glass-gold)" },
  { key: "inactive", label: "Archived", dot: "var(--glass-text-tertiary)" },
];

export default function UsersTable({
  meId,
  rows,
  locations,
  allLocations,
}: {
  meId: string;
  rows: UserListRow[];
  locations: string[];
  allLocations: string[];
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<UserRole | "all">("all");
  const [locFilter, setLocFilter] = useState<string>("all");
  const [editing, setEditing] = useState<UserListRow | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (roleFilter !== "all" && r.role !== roleFilter) return false;
      if (locFilter !== "all" && r.location !== locFilter && !r.locations.includes(locFilter)) return false;
      if (q && !r.fullName.toLowerCase().includes(q) && !r.email.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, roleFilter, locFilter]);

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => {
      const r = ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role);
      return r !== 0 ? r : a.fullName.localeCompare(b.fullName);
    }),
    [filtered],
  );

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <select className={`${INPUT} !w-auto`} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as UserRole | "all")}>
            <option value="all">All roles</option>
            {ROLE_ORDER.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
          <select className={`${INPUT} !w-auto`} value={locFilter} onChange={(e) => setLocFilter(e.target.value)}>
            <option value="all">All locations</option>
            {locations.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] font-bold shrink-0 text-glass-text-tertiary">
            {filtered.length} of {rows.length}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or email…"
            className={`${INPUT} !w-auto min-w-[240px]`}
          />
          <button className={BTN_PRIMARY} onClick={() => setInviteOpen((v) => !v)}>+ Invite user</button>
        </div>
      </div>

      {inviteOpen && (
        <InviteForm
          allLocations={allLocations}
          onDone={() => { setInviteOpen(false); router.refresh(); }}
          onCancel={() => setInviteOpen(false)}
        />
      )}

      {filtered.length === 0 ? (
        <p className="text-sm italic py-8 text-center text-glass-text-tertiary">No users match these filters.</p>
      ) : (
        <div className="space-y-8">
          {STATUS_GROUPS.map((g) => {
            const groupRows = sorted.filter((r) => r.status === g.key);
            if (groupRows.length === 0) return null;
            return (
              <section key={g.key} className="space-y-2.5">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ background: g.dot }} />
                  <h3 className="text-xs uppercase tracking-[0.18em] font-bold text-glass-text-secondary">
                    {g.label}<span className="ml-1.5 text-glass-text-tertiary">({groupRows.length})</span>
                  </h3>
                </div>
                <div className="rounded-2xl border border-glass-border bg-glass-surface overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-[0.18em] text-glass-text-tertiary border-b border-glass-border-light">
                        <th className="px-5 py-3 font-bold">Name</th>
                        <th className="px-5 py-3 font-bold">Role</th>
                        <th className="px-5 py-3 font-bold">Location</th>
                        <th className="px-5 py-3 font-bold text-right">Edit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupRows.map((r, i) => {
                        const showRoleHeader = i === 0 || groupRows[i - 1].role !== r.role;
                        return (
                          <Fragment key={r.id}>
                            {showRoleHeader && (
                              <tr className="bg-glass-surface-hover border-t border-glass-border-light">
                                <td colSpan={4} className="px-5 py-1.5 text-[10px] uppercase tracking-[0.18em] font-bold text-glass-text-tertiary">
                                  {ROLE_LABELS[r.role]}
                                </td>
                              </tr>
                            )}
                            <tr className="border-t border-glass-border-light">
                              <td className="px-5 py-3">
                                <div className="font-semibold text-glass-text">{r.fullName}</div>
                                <div className="text-xs mt-0.5 text-glass-text-tertiary">{r.email}</div>
                              </td>
                              <td className="px-5 py-3 text-glass-text">{ROLE_LABELS[r.role]}</td>
                              <td className="px-5 py-3 text-glass-text">
                                {r.locations.length > 0
                                  ? r.locations.join(", ")
                                  : r.location ?? <span className="text-glass-text-tertiary">{r.role === "lm" ? "—" : "All locations"}</span>}
                              </td>
                              <td className="px-5 py-3 text-right">
                                <button
                                  onClick={() => setEditing(r)}
                                  className="inline-flex items-center rounded-md border border-glass-gold px-3 py-1 text-[10px] uppercase tracking-[0.16em] font-bold text-glass-gold hover:bg-glass-gold hover:text-black transition-colors"
                                >
                                  Edit
                                </button>
                              </td>
                            </tr>
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      )}

      {editing && (
        <EditUser
          user={editing}
          isSelf={editing.id === meId}
          allLocations={allLocations}
          onClose={() => { setEditing(null); router.refresh(); }}
        />
      )}
    </div>
  );
}

function InviteForm({ allLocations, onDone, onCancel }: { allLocations: string[]; onDone: () => void; onCancel: () => void }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("lm");
  const [locations, setLocations] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setError(null);
    if (!firstName.trim() || !email.trim()) { setError("First name and email are required."); return; }
    start(async () => {
      const res = await inviteUser({ firstName, lastName, email, role, locations });
      if ("error" in res) setError(res.error);
      else onDone();
    });
  }

  return (
    <div className="rounded-2xl border border-glass-border bg-glass-surface p-5 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="block">
          <span className="text-xs uppercase tracking-wider text-glass-text-tertiary font-semibold">First name</span>
          <input className={`${INPUT} mt-1`} value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Paul" />
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wider text-glass-text-tertiary font-semibold">Last name</span>
          <input className={`${INPUT} mt-1`} value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Wandili" />
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wider text-glass-text-tertiary font-semibold">Email</span>
          <input className={`${INPUT} mt-1`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="someone@brodierec.com" />
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wider text-glass-text-tertiary font-semibold">Role</span>
          <select className={`${INPUT} mt-1`} value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            {ROLE_ORDER.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </label>
        <div className="block">
          <span className="text-xs uppercase tracking-wider text-glass-text-tertiary font-semibold">Locations</span>
          <div className="mt-1">
            <LocationMultiSelect options={allLocations} value={locations} onChange={setLocations} />
          </div>
        </div>
      </div>
      {error && (
        <p className="text-sm rounded-md px-3 py-2" style={{ background: "rgba(239,68,68,0.14)", color: "rgb(248,113,113)", border: "1px solid rgba(239,68,68,0.5)" }}>{error}</p>
      )}
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} className={BTN_SECONDARY}>Cancel</button>
        <button type="button" onClick={submit} disabled={pending} className={`${BTN_PRIMARY} px-6`}>
          {pending ? "Sending…" : "Send invite"}
        </button>
      </div>
    </div>
  );
}
