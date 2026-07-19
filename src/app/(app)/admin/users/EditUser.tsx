"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { updateUser, resendInvite, setUserArchived } from "./actions";
import { ROLE_LABELS, ROLE_ORDER, type UserRole, type UserStatus } from "./roles";
import type { UserListRow } from "./UsersTable";

const INPUT =
  "w-full rounded-lg border border-glass-border bg-glass-surface px-3 py-2 text-sm text-glass-text placeholder:text-glass-text-tertiary focus:outline-none focus:border-glass-gold transition";

function splitName(full: string): { first: string; last: string } {
  const t = (full ?? "").trim();
  const i = t.indexOf(" ");
  return i === -1 ? { first: t, last: "" } : { first: t.slice(0, i), last: t.slice(i + 1).trim() };
}

export function EditUser({
  user,
  isSelf,
  onClose,
}: {
  user: UserListRow;
  isSelf: boolean;
  onClose: () => void;
}) {
  const initial = useMemo(() => splitName(user.fullName), [user.fullName]);
  const [firstName, setFirstName] = useState(initial.first);
  const [lastName, setLastName] = useState(initial.last);
  const [role, setRole] = useState<UserRole>(user.role);
  const [pending, startTransition] = useTransition();
  const [archiving, startArchive] = useTransition();
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
  const isArchived = user.status === "inactive";
  const isInvited = user.status === "invited";
  const dirty = fullName !== user.fullName || role !== user.role;

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function save() {
    setError(null);
    if (!fullName.trim()) { setError("First name is required."); return; }
    startTransition(async () => {
      const res = await updateUser({
        userId: user.id,
        fullName: fullName !== user.fullName ? fullName : undefined,
        role: role !== user.role ? role : undefined,
      });
      if ("error" in res) { setError(res.error); return; }
      onClose();
    });
  }

  function onArchive() {
    if (isSelf) return;
    const msg = isArchived
      ? `Reactivate ${user.fullName}? They'll be able to sign in again.`
      : `Archive ${user.fullName} (${user.email})?\n\nThey'll be blocked from signing in, but every record keeps their name and history. You can reactivate them anytime.`;
    if (!confirm(msg)) return;
    setError(null);
    startArchive(async () => {
      const res = await setUserArchived(user.id, !isArchived);
      if ("error" in res) setError(res.error);
      else onClose();
    });
  }

  function onResend() {
    setError(null);
    setResendState("sending");
    startTransition(async () => {
      const res = await resendInvite(user.email);
      if ("error" in res) { setError(res.error); setResendState("idle"); }
      else { setResendState("sent"); setTimeout(() => setResendState("idle"), 2500); }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto px-4 py-12"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-[520px] rounded-2xl overflow-hidden" style={{ background: "var(--glass-background)", border: "1px solid var(--glass-border-light)" }}>
        <div className="flex items-start justify-between px-6 pt-6">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] mb-1" style={{ color: "var(--glass-gold)" }}>
              Edit user{isArchived ? " · Archived" : isInvited ? " · Invited" : ""}
            </div>
            <h2 className="text-2xl font-semibold" style={{ color: "var(--glass-text)" }}>{user.fullName}</h2>
            <p className="text-xs mt-0.5 text-glass-text-tertiary">{user.email}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1 -mr-1 -mt-1 text-glass-text-tertiary">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>

        <div className="px-6 pt-5 pb-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="text-xs uppercase tracking-wider text-glass-text-tertiary font-semibold">First name</span>
              <input className={`${INPUT} mt-1`} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </label>
            <label className="block">
              <span className="text-xs uppercase tracking-wider text-glass-text-tertiary font-semibold">Last name</span>
              <input className={`${INPUT} mt-1`} value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </label>
          </div>

          <label className="block">
            <span className="text-xs uppercase tracking-wider text-glass-text-tertiary font-semibold">Role</span>
            <select className={`${INPUT} mt-1`} value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
              {ROLE_ORDER.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </label>

          {user.location && (
            <label className="block">
              <span className="text-xs uppercase tracking-wider text-glass-text-tertiary font-semibold">Location</span>
              <input className={`${INPUT} mt-1`} value={`${user.location} — from CRM`} readOnly style={{ color: "var(--glass-text-tertiary)" }} />
            </label>
          )}

          {error && (
            <p className="text-sm rounded-md px-3 py-2" style={{ background: "rgba(239,68,68,0.14)", color: "rgb(248,113,113)", border: "1px solid rgba(239,68,68,0.5)" }}>{error}</p>
          )}
          {resendState === "sent" && (
            <p className="text-sm rounded-md px-3 py-2" style={{ background: "rgba(34,197,94,0.14)", color: "rgb(74,222,128)", border: "1px solid rgba(34,197,94,0.45)" }}>Invite email re-sent.</p>
          )}
        </div>

        <div style={{ borderTop: "1px solid var(--glass-border-light)" }}>
          {(isInvited || !isSelf) && (
            <div className="flex flex-col items-start gap-2.5 px-6 pt-4">
              {isInvited && (
                <button onClick={onResend} disabled={resendState === "sending"}
                  className="rounded-lg border border-glass-border bg-glass-surface text-[11px] uppercase tracking-[0.14em] font-bold px-3 py-1.5 hover:bg-glass-surface-hover disabled:opacity-40 transition">
                  {resendState === "sending" ? "Sending…" : "Resend invite"}
                </button>
              )}
              {!isSelf && (
                <button onClick={onArchive} disabled={archiving}
                  className="rounded-lg text-[11px] uppercase tracking-[0.14em] font-bold px-3 py-1.5 disabled:opacity-40 transition border"
                  style={isArchived
                    ? { borderColor: "var(--glass-border)", color: "var(--glass-text)" }
                    : { borderColor: "rgba(239,68,68,0.5)", color: "rgb(248,113,113)" }}>
                  {archiving ? (isArchived ? "Reactivating…" : "Archiving…") : (isArchived ? "Reactivate user" : "Archive user")}
                </button>
              )}
            </div>
          )}
          <div className="flex items-center justify-between gap-3 px-6 py-4">
            <button onClick={onClose} className="rounded-lg border border-glass-border bg-glass-surface text-[11px] uppercase tracking-[0.14em] font-bold px-3.5 py-2 hover:bg-glass-surface-hover transition">Cancel</button>
            <button onClick={save} disabled={pending || !dirty}
              className="rounded-lg bg-glass-gold text-black font-semibold text-sm px-5 py-2 hover:brightness-110 disabled:opacity-40 transition">
              {pending ? "Saving…" : dirty ? "Save changes" : "Saved"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
