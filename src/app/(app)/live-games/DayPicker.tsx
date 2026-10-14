"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";

// The day the Live games page shows: back a day, forward a day, pick one, or
// jump to today. Today stays out of the URL, so the default page is today.
const shift = (day: string, by: number) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + by)).toISOString().slice(0, 10);
};

export default function DayPicker({ value, today }: { value: string; today: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();

  function go(day: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
    const q = new URLSearchParams(search.toString());
    if (day === today) q.delete("date");
    else q.set("date", day);
    const qs = q.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-bold text-glass-text-tertiary">Date</span>
      <div className={`flex items-center gap-1.5 ${pending ? "opacity-60" : ""}`}>
        <button type="button" onClick={() => go(shift(value, -1))} className="br-btn is-grey is-sm" aria-label="Previous day">←</button>
        <input type="date" value={value} onChange={(e) => go(e.target.value)}
          className="rounded-lg border border-glass-border bg-glass-surface px-3 py-1.5 text-sm text-glass-text focus:outline-none focus:border-glass-gold transition" />
        <button type="button" onClick={() => go(shift(value, 1))} className="br-btn is-grey is-sm" aria-label="Next day">→</button>
        {value !== today && (
          <button type="button" onClick={() => go(today)} className="br-btn is-outline is-sm">Today</button>
        )}
      </div>
    </label>
  );
}
