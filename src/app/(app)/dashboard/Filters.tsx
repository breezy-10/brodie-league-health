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
  // When provided, a Week filter (Saturday–Friday) renders between Season and
  // Location. Values are the week's Saturday, "YYYY-MM-DD".
  weeks?: { value: string; label: string }[];
  // When true, From and To date fields render after Location ("YYYY-MM-DD",
  // either may be left empty).
  dates?: boolean;
  // When provided, a District filter renders after Location (param
  // "district"); the page narrows its locations to the chosen districts.
  districts?: string[];
}

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

export default function Filters({
  options,
  current,
  keep,
}: {
  options: FilterOptions;
  /** Params this bar doesn't own but must not drop — it rebuilds the query
      string from scratch, so anything not listed here is lost on apply. */
  keep?: Record<string, string>;
  // Each filter is a list: [] means "all locations", and for season/week means
  // "the default" (the resolved season / current week).
  current: { seasons: string[]; locations: string[]; weeks?: string[]; from?: string; to?: string; districts?: string[] };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const hasWeeks = !!options.weeks?.length;
  const hasDistricts = !!options.districts?.length;

  // Stage the selections locally; only push to the URL when Apply is clicked.
  const [seasons, setSeasons] = useState(current.seasons);
  const [weeks, setWeeks] = useState(current.weeks ?? []);
  const [locations, setLocations] = useState(current.locations);
  const [districts, setDistricts] = useState(current.districts ?? []);
  const [from, setFrom] = useState(current.from ?? "");
  const [to, setTo] = useState(current.to ?? "");

  const dirty =
    !sameSet(seasons, current.seasons) || !sameSet(locations, current.locations) ||
    (hasWeeks && !sameSet(weeks, current.weeks ?? [])) ||
    (hasDistricts && !sameSet(districts, current.districts ?? [])) ||
    (!!options.dates && (from !== (current.from ?? "") || to !== (current.to ?? "")));

  function apply() {
    if (!dirty) return;
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(keep ?? {})) next.set(k, v);
    if (seasons.length) next.set("season", seasons.join(","));
    if (hasWeeks && weeks.length) next.set("week", weeks.join(","));
    if (locations.length) next.set("location", locations.join(","));
    if (hasDistricts && districts.length) next.set("district", districts.join(","));
    if (options.dates && from) next.set("from", from);
    if (options.dates && to) next.set("to", to);
    const qs = next.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      {/* A page with no seasons to offer (Events) shows the location only. */}
      {options.seasons.length > 0 && (
        <Field label="Season">
          <MultiSelect
            options={options.seasons}
            value={seasons}
            onChange={setSeasons}
            allLabel="Current season"
            singularNoun="seasons"
          />
        </Field>
      )}
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
          searchable
        />
      </Field>
      {hasDistricts && (
        <Field label="District">
          <MultiSelect
            options={options.districts!.map((d) => ({ value: d, label: d }))}
            value={districts}
            onChange={setDistricts}
            allLabel="All districts"
            singularNoun="districts"
          />
        </Field>
      )}
      {options.dates && (
        <>
          <Field label="From">
            <input type="date" className={SELECT} value={from} max={to || undefined}
              onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <input type="date" className={SELECT} value={to} min={from || undefined}
              onChange={(e) => setTo(e.target.value)} />
          </Field>
        </>
      )}
      <button
        onClick={apply}
        disabled={pending || !dirty}
        className={`br-btn ${pending ? "is-grey" : ""}`}
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
      <span className="text-xs font-bold text-glass-text-tertiary">{label}</span>
      {children}
    </label>
  );
}
