"use client";

import { useState } from "react";

// One leaderboard row. A location that plays more than one night opens to show
// a row per night under it (`nights`, rendered on the server); one that plays a
// single night names it under the location (`onlyNight`).
export function LeaderboardRow({ rank, name, sub, cells, nights, nightCount, onlyNight }: {
  rank: number;
  name: string;
  sub?: React.ReactNode;
  cells: React.ReactNode;
  nights?: React.ReactNode;
  nightCount?: number;
  onlyNight?: string;
}) {
  const [open, setOpen] = useState(false);
  const top = rank <= 3;
  return (
    <>
      <tr style={{ borderTop: "1px solid var(--glass-border)" }}>
        <td className="px-4 py-2.5 text-right tabular align-top w-10"
          style={{ color: top ? "var(--glass-text)" : "var(--glass-text-tertiary)", fontWeight: top ? 700 : 500 }}>
          {rank}
        </td>
        <td className="px-4 py-2.5 align-top">
          <div className="flex items-center gap-1.5">
            {nights ? (
              <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                aria-label={`${open ? "Hide" : "Show"} ${name} by day`}
                className="shrink-0 -ml-1 px-1 py-0.5 rounded hover:bg-glass-surface-hover focus-visible:outline focus-visible:outline-2"
                style={{ color: "var(--glass-text-tertiary)" }}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden
                  className="transition-transform duration-150"
                  style={{ transform: open ? "rotate(180deg)" : undefined }}>
                  <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5"
                    strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            ) : null}
            <span className="font-semibold" style={{ color: "var(--glass-text)" }}>{name}</span>
          </div>
          {nights && nightCount ? (
            <div className="text-[11px] text-glass-text-tertiary">{nightCount} days</div>
          ) : onlyNight ? (
            <div className="text-[11px] text-glass-text-tertiary">{onlyNight}</div>
          ) : null}
          {sub}
        </td>
        {cells}
      </tr>
      {open ? nights : null}
    </>
  );
}
