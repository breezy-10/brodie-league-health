"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

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
  const params = useSearchParams();

  function set(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value === "all" || value === "") next.delete(key);
    else next.set(key, value);
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Field label="Season">
        <select className={SELECT} value={current.season} onChange={(e) => set("season", e.target.value)}>
          {options.seasons.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </Field>
      <Field label="Location">
        <select className={SELECT} value={current.location} onChange={(e) => set("location", e.target.value)}>
          <option value="all">All locations</option>
          {options.locations.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </Field>
      <Field label="Lead manager">
        <select className={SELECT} value={current.lm} onChange={(e) => set("lm", e.target.value)}>
          <option value="all">All lead managers</option>
          {options.lms.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </Field>
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
