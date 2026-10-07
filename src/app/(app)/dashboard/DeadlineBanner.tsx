"use client";

import { useEffect, useState } from "react";

export type DeadlineWeek = {
  season: string;
  season_label: string;
  week: number;
  date: string;               // YYYY-MM-DD
  deadline: string;
  opens_at_midnight: boolean;
  tier_label: string | null;
  // country: "Canada" | "US" — sent by the Promo Tracker's feed so the price
  // table can split per country; absent on an older feed.
  tracks: { country?: string; short: string; label: string; price: string; team_fee: string }[];
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
const PROMO_APP_URL = "https://registration-promo-tracker.vercel.app";

/**
 * The Promo Tracker's deadline banner, on this dashboard — the same card as its
 * own countdown hero: the deadline and a More info button, the price in effect
 * split into one bordered table per country, and the countdown.
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
  // The Promo Tracker's registration promos page.
  const infoHref = `${PROMO_APP_URL}/registration-promos`;

  return (
    <div
      className="rounded-xl px-5 py-4 flex flex-col gap-3 sm:grid sm:items-center sm:gap-4 shadow-card"
      style={{
        background: "var(--glass-surface)",
        borderColor: "var(--glass-gold)",
        gridTemplateColumns: "clamp(200px, 34%, 380px) auto minmax(0,1fr)",
      }}
    >
      <div className="min-w-0">
        <div className="text-[11px]" style={{ color: "var(--glass-text-tertiary)" }}>
          Upcoming deadline
        </div>
        <div className="text-xl font-semibold mt-1" style={{ color: "var(--glass-text)" }}>{w.deadline}</div>
        <div className="text-xs mt-1" style={{ color: "var(--glass-text-secondary)" }}>
          {DAYS[dt.getDay()]}, {MONTHS[dt.getMonth()]} {dt.getDate()} · {w.opens_at_midnight ? "12:00am" : "11:59pm"}
        </div>
        <a
          href={infoHref}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`More info about ${w.deadline}`}
          className="br-btn is-outline is-sm mt-2 whitespace-nowrap"
        >
          More info ↗
        </a>
      </div>
      <PriceTable week={w} />
      <div className="tabular font-bold leading-none text-3xl sm:text-4xl lg:text-5xl sm:text-right"
        style={{ color: "var(--glass-gold)" }}>
        {countdown(next.at - now)}
      </div>
    </div>
  );
}

// The Promo Tracker's price table: the tier, then one bordered table per
// country (New / Existing location, price, team fee), and the note on what
// new and existing mean.
function PriceTable({ week }: { week: DeadlineWeek }) {
  if (!week.tracks.length) return null;
  const countries: { country: string; rows: DeadlineWeek["tracks"] }[] = [];
  for (const t of week.tracks) {
    const c = t.country ?? "";
    const last = countries[countries.length - 1];
    if (last && last.country === c) last.rows.push(t);
    else countries.push({ country: c, rows: [t] });
  }
  // A Numbers-style table: hairlines between rows, none around the cells.
  const cell = { borderBottom: "1px solid var(--divider)" };
  const head = "text-xs font-medium text-glass-text-tertiary px-2 py-1";
  return (
    <div>
      {week.tier_label && (
        <div className="font-semibold text-[11px] mb-1.5" style={{ color: "var(--glass-text)" }}>
          {week.tier_label}
        </div>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:gap-5">
        {countries.map((g) => (
          <div key={g.country || "all"}>
            {g.country && (
              <div className="font-semibold text-[11px] mb-1" style={{ color: "var(--glass-text)" }}>
                {g.country}
              </div>
            )}
            <table className="w-fit" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th className={`${head} text-left`} style={{ ...cell, color: "var(--glass-text-secondary)" }}>Location</th>
                  <th className={`${head} text-right`} style={{ ...cell, color: "var(--glass-text-secondary)" }}>Price</th>
                  <th className={`${head} text-right`} style={{ ...cell, color: "var(--glass-text-secondary)" }}>Team fee</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((t) => (
                  <tr key={`${g.country}-${t.short}`}>
                    <td className="whitespace-nowrap font-medium text-xs px-2 py-1" style={{ ...cell, color: "var(--glass-text)" }}>{t.short}</td>
                    <td className="tabular font-semibold text-right whitespace-nowrap text-xs px-2 py-1" style={{ ...cell, color: "var(--glass-text)" }}>{t.price}</td>
                    <td className="tabular text-right whitespace-nowrap text-xs px-2 py-1" style={{ ...cell, color: "var(--glass-text-secondary)" }}>{t.team_fee}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-[10px]" style={{ color: "var(--glass-text-secondary)" }}>
        New / existing refers to the location, not the player or team.
      </p>
    </div>
  );
}
