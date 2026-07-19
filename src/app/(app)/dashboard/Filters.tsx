"use client";

import { useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";

function Spinner() {
  return (
    <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

const SELECT =
  "rounded-lg border border-glass-border bg-glass-surface px-3 py-2 text-sm text-glass-text focus:outline-none focus:border-glass-gold transition";

export interface FilterOptions {
  seasons: { value: string; label: string }[];
  locations: string[];
  lms: { id: string; name: string }[];
}

export default function Filters({
  options,
  current,
}: {
  options: FilterOptions;
  current: { season: string; location: string; lm: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  // Stage the selections locally; only push to the URL when Apply is clicked.
  const [season, setSeason] = useState(current.season);
  const [location, setLocation] = useState(current.location);
  const [lm, setLm] = useState(current.lm);

  const dirty = season !== current.season || location !== current.location || lm !== current.lm;

  function apply() {
    if (!dirty) return;
    const next = new URLSearchParams();
    if (season) next.set("season", season);
    if (location && location !== "all") next.set("location", location);
    if (lm && lm !== "all") next.set("lm", lm);
    const qs = next.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label="Season">
        <select className={SELECT} value={season} onChange={(e) => setSeason(e.target.value)}>
          {options.seasons.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </Field>
      <Field label="Location">
        <select className={SELECT} value={location} onChange={(e) => setLocation(e.target.value)}>
          <option value="all">All locations</option>
          {options.locations.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </Field>
      <Field label="League manager">
        <select className={SELECT} value={lm} onChange={(e) => setLm(e.target.value)}>
          <option value="all">All league managers</option>
          {options.lms.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </Field>
      <button
        onClick={apply}
        disabled={pending || !dirty}
        className={`inline-flex items-center gap-2 rounded-lg font-semibold text-sm px-5 py-2 transition ${
          pending
            ? "border border-glass-border bg-glass-surface text-glass-text cursor-default"
            : dirty
              ? "bg-glass-gold text-black hover:brightness-110"
              : "bg-glass-gold text-black opacity-40 cursor-default"
        }`}
      >
        {pending && <Spinner />}
        {pending ? "Applying…" : dirty ? "Apply" : "Applied"}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-[0.16em] font-bold text-glass-text-tertiary">{label}</span>
      {children}
    </label>
  );
}
