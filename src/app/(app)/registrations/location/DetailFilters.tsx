"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

const SELECT =
  "rounded-lg border border-glass-border bg-glass-surface px-3 py-2 text-sm text-glass-text focus:outline-none focus:border-glass-gold transition";

export function DetailFilters({
  loc,
  season,
  locations,
  seasons,
}: {
  loc: string;
  season: string;
  locations: string[];
  seasons: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function go(nextLoc: string, nextSeason: string) {
    const qs = new URLSearchParams({ loc: nextLoc, season: nextSeason }).toString();
    startTransition(() => router.push(`/registrations/location?${qs}`));
  }

  return (
    <div className="flex flex-wrap items-end gap-3" style={{ opacity: pending ? 0.6 : 1 }}>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-[0.16em] font-bold text-glass-text-tertiary">Location</span>
        <select className={SELECT} value={loc} disabled={pending} onChange={(e) => go(e.target.value, season)}>
          {locations.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-[0.16em] font-bold text-glass-text-tertiary">Season</span>
        <select className={SELECT} value={season} disabled={pending} onChange={(e) => go(loc, e.target.value)}>
          {seasons.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
    </div>
  );
}
