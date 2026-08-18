"use client";

import { useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { MultiSelect } from "./MultiSelect";

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
  // When provided, a Week filter (Saturday–Friday) renders between Season and
  // Location. Values are the week's Saturday, "YYYY-MM-DD".
  weeks?: { value: string; label: string }[];
}

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

export default function Filters({
  options,
  current,
}: {
  options: FilterOptions;
  // Each filter is a list: [] means "all" for location/league manager, and for
  // season/week means "the default" (the resolved season / current week).
  current: { seasons: string[]; locations: string[]; lms: string[]; weeks?: string[] };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const hasWeeks = !!options.weeks?.length;

  // Stage the selections locally; only push to the URL when Apply is clicked.
  const [seasons, setSeasons] = useState(current.seasons);
  const [weeks, setWeeks] = useState(current.weeks ?? []);
  const [locations, setLocations] = useState(current.locations);
  const [lms, setLms] = useState(current.lms);

  const dirty =
    !sameSet(seasons, current.seasons) || !sameSet(locations, current.locations) ||
    !sameSet(lms, current.lms) || (hasWeeks && !sameSet(weeks, current.weeks ?? []));

  function apply() {
    if (!dirty) return;
    const next = new URLSearchParams();
    if (seasons.length) next.set("season", seasons.join(","));
    if (hasWeeks && weeks.length) next.set("week", weeks.join(","));
    if (locations.length) next.set("location", locations.join(","));
    if (lms.length) next.set("lm", lms.join(","));
    const qs = next.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label="Season">
        <MultiSelect
          options={options.seasons}
          value={seasons}
          onChange={setSeasons}
          allLabel="Current season"
          singularNoun="seasons"
        />
      </Field>
      {hasWeeks && (
        <Field label="Week">
          <MultiSelect
            options={options.weeks!}
            value={weeks}
            onChange={setWeeks}
            allLabel="Current week"
            singularNoun="weeks"
          />
        </Field>
      )}
      <Field label="Location">
        <MultiSelect
          options={options.locations.map((l) => ({ value: l, label: l }))}
          value={locations}
          onChange={setLocations}
          allLabel="All locations"
          singularNoun="locations"
        />
      </Field>
      <Field label="League manager">
        <MultiSelect
          options={options.lms.map((l) => ({ value: l.id, label: l.name }))}
          value={lms}
          onChange={setLms}
          allLabel="All league managers"
          singularNoun="league managers"
        />
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
