"use client";

import { Fragment, useEffect, useState } from "react";

export type DeadlineWeek = {
  season: string;
  season_label: string;
  week: number;
  date: string;               // YYYY-MM-DD
  deadline: string;
  opens_at_midnight: boolean;
  tier_label: string | null;
  tracks: { short: string; label: string; price: string; team_fee: string }[];
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// The moment a deadline falls, in the viewer's own timezone — registration
// opens at midnight and everything else cuts off at 11:59pm, each in local
// time. The Promo Tracker resolves it the same way, and for the same reason
// only ever on the client.
function instant(w: DeadlineWeek): Date {
  const [y, m, d] = w.date.split("-").map(Number);
  return w.opens_at_midnight
    ? new Date(y, m - 1, d, 0, 0, 0, 0)
    : new Date(y, m - 1, d, 23, 59, 0, 0);
}

function countdown(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  const d = Math.floor(total / 86400);
  return `${d > 0 ? `${d}d ` : ""}${pad(Math.floor((total % 86400) / 3600))}h ${pad(Math.floor((total % 3600) / 60))}m ${pad(total % 60)}s`;
}

/**
 * The Promo Tracker's deadline banner, on this dashboard.
 *
 * Ticks in its own component so only the clock repaints each second, and
 * re-picks the soonest deadline on every tick so it rolls over the moment one
 * lapses rather than sitting at zero.
 */
export default function DeadlineBanner({ weeks }: { weeks: DeadlineWeek[] }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Nothing until mounted: the deadline resolves against a timezone the server
  // does not have, and rendering it twice differently is a hydration error.
  if (now === null) return null;
  const next = weeks
    .map((w) => ({ w, at: instant(w).getTime() }))
    .filter((x) => x.at > now)
    .sort((a, b) => a.at - b.at)[0];
  if (!next) return null;
  const { w } = next;
  const dt = instant(w);

  return (
    <div className="rounded-xl border px-5 py-4 flex items-center justify-between gap-4 flex-wrap"
      style={{ background: "var(--glass-surface)", borderColor: "var(--glass-gold)" }}>
      <div className="min-w-0">
        <div className="font-mono text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--glass-text-tertiary)" }}>
          Next deadline
        </div>
        <div className="text-xl font-semibold mt-1" style={{ color: "var(--glass-text)" }}>{w.deadline}</div>
        <div className="text-xs mt-1" style={{ color: "var(--glass-text-secondary)" }}>
          {DAYS[dt.getDay()]}, {MONTHS[dt.getMonth()]} {dt.getDate()} · {w.opens_at_midnight ? "12:00am" : "11:59pm"}
        </div>
      </div>
      {w.tracks.length > 0 && (
        <div>
          {w.tier_label && (
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] mb-1.5" style={{ color: "var(--glass-text-tertiary)" }}>
              {w.tier_label}
            </div>
          )}
          <div className="grid w-fit gap-x-4 gap-y-[3px] text-xs leading-tight items-baseline"
            style={{ gridTemplateColumns: "auto auto auto" }}>
            <span />
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-right whitespace-nowrap" style={{ color: "var(--glass-text-tertiary)" }}>Price</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-right whitespace-nowrap" style={{ color: "var(--glass-text-tertiary)" }}>Team fee</span>
            {w.tracks.map((t) => (
              <Fragment key={t.short}>
                <span className="whitespace-nowrap" style={{ color: "var(--glass-text-tertiary)" }}>{t.short}</span>
                <span className="tabular font-semibold text-right whitespace-nowrap" style={{ color: "var(--glass-text)" }}>{t.price}</span>
                <span className="tabular text-right whitespace-nowrap" style={{ color: "var(--glass-text-secondary)" }}>{t.team_fee}</span>
              </Fragment>
            ))}
          </div>
        </div>
      )}
      <div className="font-mono tabular font-bold leading-none text-3xl sm:text-5xl" style={{ color: "var(--glass-gold)" }}>
        {countdown(next.at - now)}
      </div>
    </div>
  );
}
