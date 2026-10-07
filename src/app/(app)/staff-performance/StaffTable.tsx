"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import type { StaffMember } from "@/lib/staff-roster";
import { rateStaff } from "./actions";

const INPUT =
  "w-full rounded-lg border border-glass-border bg-glass-surface px-3 py-2 text-sm text-glass-text placeholder:text-glass-text-tertiary focus:outline-none focus:border-glass-gold transition";

type StatusFilter = "current" | "former" | "all";

// Pinned to Toronto so the server and browser render the same date.
const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Toronto" });

// 0-4 needs attention, 5-7 is fair, 8-10 is strong.
function band(n: number) {
  if (n <= 4) return { ink: "var(--glass-red)", tint: "var(--glass-red-light)" };
  if (n <= 7) return { ink: "var(--glass-yellow)", tint: "var(--glass-yellow-light)" };
  return { ink: "var(--glass-green)", tint: "var(--glass-green-light)" };
}

type Rating = { rating: number | null; ratedBy: string | null; ratedAt: string | null };

export default function StaffTable({
  staff,
  locationOptions,
  ratingsReady,
}: {
  staff: StaffMember[];
  locationOptions: string[];
  ratingsReady: boolean;
}) {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [locFilter, setLocFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("current");
  const [ratings, setRatings] = useState<Record<string, Rating>>(() =>
    Object.fromEntries(staff.map((s) => [s.id, { rating: s.rating, ratedBy: s.ratedBy, ratedAt: s.ratedAt }])),
  );
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Already in seniority order, as the roster arrives sorted.
  const roles = useMemo(() => [...new Set(staff.map((s) => s.role))], [staff]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return staff.filter((s) => {
      if (statusFilter === "current" && s.status === "inactive") return false;
      if (statusFilter === "former" && s.status !== "inactive") return false;
      if (roleFilter !== "all" && s.role !== roleFilter) return false;
      if (locFilter !== "all" && !s.locations.includes(locFilter)) return false;
      if (q && !s.name.toLowerCase().includes(q) && !s.email.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [staff, search, roleFilter, locFilter, statusFilter]);

  const rated = filtered.map((s) => ratings[s.id]?.rating).filter((r): r is number => r != null);
  const average = rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : null;

  function rate(person: StaffMember, rating: number) {
    if (saving || ratings[person.id]?.rating === rating) return;
    const before = ratings[person.id];
    setError(null);
    setSaving(person.id);
    setRatings((r) => ({ ...r, [person.id]: { ...before, rating } }));
    startTransition(async () => {
      const res = await rateStaff({ trainingUserId: person.id, rating });
      if ("error" in res) {
        setRatings((r) => ({ ...r, [person.id]: before }));
        setError(`${person.name}: ${res.error}`);
      } else {
        setRatings((r) => ({ ...r, [person.id]: { rating, ratedBy: res.ratedBy, ratedAt: res.ratedAt } }));
      }
      setSaving(null);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <select className={`${INPUT} !w-auto`} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
            <option value="current">Current staff</option>
            <option value="former">Former staff</option>
            <option value="all">Everyone</option>
          </select>
          <select className={`${INPUT} !w-auto`} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            <option value="all">All roles</option>
            {roles.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select className={`${INPUT} !w-auto`} value={locFilter} onChange={(e) => setLocFilter(e.target.value)}>
            <option value="all">All locations</option>
            {locationOptions.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <span className="text-xs font-bold shrink-0 text-glass-text-tertiary">
            {filtered.length} of {staff.length}
          </span>
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or email…"
          className={`${INPUT} sm:!w-auto sm:min-w-[240px]`}
        />
      </div>

      <p className="text-sm text-glass-text-secondary">
        {rated.length} of {filtered.length} rated
        {average != null && <> · average <span className="font-semibold text-glass-text tabular-nums">{average.toFixed(1)}</span></>}
      </p>

      {!ratingsReady && (
        <p className="text-sm rounded-md px-3 py-2 border border-glass-border bg-glass-surface text-glass-text-secondary">
          Ratings aren&apos;t set up yet, so they can&apos;t be saved.
        </p>
      )}
      {error && (
        <p className="text-sm rounded-md px-3 py-2" style={{ background: "var(--glass-red-light)", color: "var(--glass-red)", border: "1px solid var(--glass-red)" }}>
          {error}
        </p>
      )}

      {filtered.length === 0 ? (
        <p className="text-sm italic py-8 text-center text-glass-text-tertiary">No staff match these filters.</p>
      ) : (
        <div className="rounded-2xl bg-glass-surface overflow-x-auto shadow-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-glass-text-tertiary border-b border-glass-border-light">
                <th className="px-5 py-3 font-bold">Name</th>
                <th className="px-5 py-3 font-bold">Role</th>
                <th className="px-5 py-3 font-bold">Location</th>
                <th className="px-5 py-3 font-bold">Rating</th>
                <th className="px-5 py-3 font-bold">Last rated</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s, i) => {
                const showRoleHeader = i === 0 || filtered[i - 1].role !== s.role;
                const r = ratings[s.id];
                return (
                  <Fragment key={s.id}>
                    {showRoleHeader && (
                      <tr className="bg-glass-surface-hover border-t border-glass-border-light">
                        <td colSpan={5} className="px-5 py-1.5 text-xs font-bold text-glass-text-tertiary">
                          {s.role}
                        </td>
                      </tr>
                    )}
                    <tr className="border-t border-glass-border-light align-middle">
                      <td className="px-5 py-3 min-w-[200px]">
                        <div className="font-semibold text-glass-text">
                          {s.name}
                          {s.status !== "active" && (
                            <span className="ml-2 text-[11px] font-normal text-glass-text-tertiary">
                              {s.status === "invited" ? "Invited" : "Former"}
                            </span>
                          )}
                        </div>
                        <div className="text-xs mt-0.5 text-glass-text-tertiary">{s.email}</div>
                      </td>
                      <td className="px-5 py-3 text-glass-text whitespace-nowrap">{s.role}</td>
                      <td className="px-5 py-3 text-glass-text min-w-[160px]">
                        {s.locations.length > 0 ? (
                          <span className="flex flex-wrap gap-x-1.5 gap-y-1">
                            {s.locations.map((n) => (
                              <span key={n} className="rounded px-1.5 py-0.5 text-xs whitespace-nowrap bg-glass-surface-hover text-glass-text-secondary">{n}</span>
                            ))}
                          </span>
                        ) : (
                          <span className="text-glass-text-tertiary">No locations</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <RatingScale
                          name={s.name}
                          value={r?.rating ?? null}
                          disabled={!ratingsReady || saving === s.id}
                          onRate={(n) => rate(s, n)}
                        />
                      </td>
                      <td className="px-5 py-3 text-xs text-glass-text-tertiary whitespace-nowrap">
                        {r?.ratedAt ? (
                          <>
                            <div className="text-glass-text-secondary">{DAY.format(new Date(r.ratedAt))}</div>
                            {r.ratedBy && <div className="mt-0.5">by {r.ratedBy}</div>}
                          </>
                        ) : (
                          "Not rated"
                        )}
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RatingScale({
  name,
  value,
  disabled,
  onRate,
}: {
  name: string;
  value: number | null;
  disabled: boolean;
  onRate: (n: number) => void;
}) {
  return (
    <div role="radiogroup" aria-label={`Rating for ${name}, 0 to 10`} className="flex flex-wrap gap-1 min-w-[200px]">
      {Array.from({ length: 11 }, (_, n) => {
        const on = value === n;
        const c = band(n);
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onRate(n)}
            className="w-7 h-7 rounded-full border text-xs font-semibold tabular-nums transition disabled:cursor-not-allowed border-glass-border text-glass-text-secondary hover:border-[color:var(--hairline-strong)] hover:text-glass-text disabled:hover:border-glass-border"
            style={on ? { background: c.tint, color: c.ink, borderColor: c.ink } : undefined}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}
