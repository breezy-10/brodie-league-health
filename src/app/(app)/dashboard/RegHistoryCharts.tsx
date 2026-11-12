"use client";

import { useState, type ReactNode } from "react";

// Registrations > Historical's charts, drawn here so the key can filter them
// without a round trip: click a term (Winter, Spring, Summer, Fall) to show
// only its seasons on every chart, click more to add them, click one again to
// put it back; nothing picked shows every season (Sohaib, Nov 11). The data
// and the copy around the charts come from RegHistory on the server.

// Bars are coloured by term in Brodie's seasonal colours (winter blue, spring
// green, summer yellow, fall red), so every summer reads alike and so on; the
// legend names them and every bar carries its season under it.
const TERM_COLORS: { term: string; color: string }[] = [
  { term: "Winter", color: "var(--viz-winter)" },
  { term: "Spring", color: "var(--viz-spring)" },
  { term: "Summer", color: "var(--viz-summer)" },
  { term: "Fall", color: "var(--viz-fall)" },
];
const termColor = (season: string) =>
  TERM_COLORS.find((t) => season.toLowerCase().startsWith(t.term.toLowerCase()))?.color ?? "var(--viz-prev)";

// The same term a year earlier: Summer '24 for Summer '25.
function yearBefore(season: string): string | null {
  const m = season.match(/^(\S+) '(\d{2})$/);
  return m ? `${m[1]} '${String(Number(m[2]) - 1).padStart(2, "0")}` : null;
}
// Change against the season compared with: the count, then as a share of
// that season, one decimal, both signed: "+210 (+48.4%)". Up is green and down
// red (the status colours, which brighten in dark mode); no change stays ink.
// The gap is written the way the chart writes its values (abs).
function change(value: number, against: number | undefined, abs: (n: number) => string = (n) => n.toLocaleString()): { text: string; color?: string } {
  if (!against) return { text: "–" };
  const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "");
  const n = value - against;
  const d = (100 * n) / against;
  return {
    text: `${sign(n)}${abs(Math.abs(n))} (${sign(d)}${Math.abs(d).toFixed(1)}%)`,
    color: n > 0 ? "var(--glass-success-text)" : n < 0 ? "var(--glass-danger-text)" : undefined,
  };
}
// The same for a percentage: the gap in points, one decimal, "+2.3 pts".
function changePts(value: number, against: number | undefined): { text: string; color?: string } {
  if (against == null) return { text: "–" };
  const n = Math.round((value - against) * 10) / 10;
  return {
    text: `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)} pts`,
    color: n > 0 ? "var(--glass-success-text)" : n < 0 ? "var(--glass-danger-text)" : undefined,
  };
}
// Locations in this season that the season compared with didn't have.
function newLocations(locs: string[] | null, against: string[] | null | undefined): string {
  if (!locs || !against) return "–";
  const had = new Set(against);
  return locs.filter((id) => !had.has(id)).length.toLocaleString();
}

// A bar's tooltip ends with its locations, or with rows of its own (details).
export type HistBar = { season: string; value: number; locations: string[] | null; details?: { label: string; value: string }[] };
type Bar = HistBar;
// How a chart writes its values: whole counts (the default), percentages to
// one decimal (changes in points), two decimals (athletes per team), or whole
// dollars with the currency after (revenue per player).
export type HistFormat = "count" | "percent" | "decimal" | "money";
export type HistChart = { title: string; noun: string; subtitle: string; bars: HistBar[]; percent?: boolean; format?: HistFormat; currency?: string };

const TRACK_PX = 150;
// Wide enough for "Summer '26" under its bar; narrower screens scroll the chart.
const COL_PX = 64;

function TipRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 whitespace-nowrap">
      <span>{label}</span>
      <span className="tabular font-semibold" style={{ color: color ?? "var(--ink)" }}>{value}</span>
    </div>
  );
}

function HistoryChart({ title, noun, subtitle, season, bars, all, format = "count", currency, current }: {
  title: string;
  noun: string;
  subtitle: string;
  season: string;
  bars: Bar[];
  format?: HistFormat;
  // For money: the currency written after the amount on the headline.
  currency?: string;
  // The season picked, for the headline, whichever terms are showing.
  current?: Bar;
  // Every season, whichever are showing: what each bar is compared with.
  all: Bar[];
}) {
  const max = Math.max(...bars.map((b) => b.value), 1);
  const abs = (v: number) =>
    format === "decimal" ? v.toFixed(2)
      : format === "money" ? `$${Math.round(v).toLocaleString()}`
      : v.toLocaleString();
  const show = (v: number) => (format === "percent" ? `${v.toFixed(1)}%` : abs(v));
  const diff = (v: number, against: number | undefined) => (format === "percent" ? changePts(v, against) : change(v, against, abs));
  return (
    <section className="rounded-2xl bg-glass-surface p-5 shadow-card min-w-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold" style={{ color: "var(--glass-text)" }}>{title}</h3>
          <p className="text-xs mt-0.5 text-glass-text-tertiary">{subtitle}</p>
        </div>
        {current && (
          <div className="text-right shrink-0">
            <span className="text-2xl font-bold tabular block" style={{ color: "var(--glass-gold)" }}>
              {show(current.value)}
              {format === "money" && currency && <span className="text-sm font-semibold text-glass-text-tertiary"> {currency}</span>}
            </span>
            <span className="text-[11px] text-glass-text-tertiary">{season}</span>
          </div>
        )}
      </div>
      {bars.length === 0 ? (
        <p className="mt-4 text-sm italic text-glass-text-tertiary">No seasons to show for this selection.</p>
      ) : (
        <div className="overflow-x-auto mt-5">
          <div style={{ minWidth: bars.length * COL_PX }}>
            {/* Bars: fixed-px track so heights are truly proportional to value. */}
            <div className="flex items-stretch gap-2" style={{ height: TRACK_PX + 22 }}>
              {bars.map((b, i) => {
                // Against the season before it and the same term a year earlier,
                // from every season, not just the terms showing: with only
                // winters picked, the bar before Winter '27 is Winter '26, and
                // both lines read the same (Sohaib, Nov 11). Where the two are
                // the same season anyway (a term that skipped a year), one line.
                // On hover or focus, beside the bar and inside the track (the
                // scroll box would clip it above), flipping left near the right
                // edge.
                const at = all.findIndex((x) => x.season === b.season);
                const prev = at > 0 ? all[at - 1] : undefined;
                const lastYearName = yearBefore(b.season);
                const lastYear = all.find((x) => x.season === lastYearName);
                const sameSeason = !!prev && prev.season === lastYearName;
                const vsPrev = diff(b.value, prev?.value), vsYear = diff(b.value, lastYear?.value);
                return (
                  <div key={b.season} tabIndex={0} aria-label={`${b.season}: ${show(b.value)} ${noun}`}
                    className="group relative flex-1 flex flex-col items-center justify-end outline-none">
                    <span className="text-[11px] font-semibold tabular mb-1" style={{ color: "var(--glass-text)" }}>{show(b.value)}</span>
                    <div className="w-full rounded-t group-hover:opacity-80 group-focus-visible:opacity-80" style={{
                      height: Math.max(Math.round((b.value / max) * TRACK_PX), 4),
                      background: termColor(b.season),
                    }} />
                    <div role="tooltip"
                      className={`br-chart-tip hidden group-hover:block group-focus-visible:block top-0 z-10 ${i >= bars.length - 3 ? "right-full mr-1" : "left-full ml-1"}`}>
                      <b>{b.season}</b>
                      <TipRow label={noun[0].toUpperCase() + noun.slice(1)} value={show(b.value)} />
                      <TipRow label={`vs ${prev?.season ?? "season before"}`} value={vsPrev.text} color={vsPrev.color} />
                      {!sameSeason && <TipRow label={`vs ${lastYearName ?? "a year earlier"}`} value={vsYear.text} color={vsYear.color} />}
                      <div className="my-1.5" style={{ borderTop: "1px solid var(--divider)" }} />
                      {b.details ? b.details.map((d) => <TipRow key={d.label} label={d.label} value={d.value} />) : (
                        <>
                          <TipRow label="Locations" value={b.locations ? b.locations.length.toLocaleString() : "–"} />
                          <TipRow label={`New vs ${prev?.season ?? "season before"}`} value={prev ? newLocations(b.locations, prev.locations) : "–"} />
                          {!sameSeason && <TipRow label={`New vs ${lastYearName ?? "a year earlier"}`} value={lastYear ? newLocations(b.locations, lastYear.locations) : "–"} />}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-2 mt-2">
              {bars.map((b) => (
                // The season picked stands out by its label, its colour being its term's.
                <span key={b.season} className={`flex-1 text-center text-[11px] whitespace-nowrap ${b.season === season ? "font-bold" : "font-semibold text-glass-text-secondary"}`}
                  style={b.season === season ? { color: "var(--glass-text)" } : undefined}>
                  {b.season}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// The key, as toggles. Picked terms read in ink on a grey pill; while any is
// picked the rest dim, and "All seasons" clears the pick.
function TermKey({ picked, onToggle, onClear }: { picked: string[]; onToggle: (term: string) => void; onClear: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5 text-xs" role="group" aria-label="Show seasons by term">
      {TERM_COLORS.map((t) => {
        const on = picked.includes(t.term);
        return (
          <button key={t.term} type="button" aria-pressed={on} onClick={() => onToggle(t.term)}
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold transition-opacity ${picked.length && !on ? "opacity-40 hover:opacity-80" : ""}`}
            style={on
              ? { background: "var(--fill-3)", color: "var(--glass-text)" }
              : { color: "var(--glass-text-secondary)" }}>
            <span aria-hidden className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: t.color }} />
            {t.term}
          </button>
        );
      })}
      {picked.length > 0 && (
        <button type="button" onClick={onClear} className="br-link px-2 py-1 font-semibold">All seasons</button>
      )}
    </div>
  );
}

const termOf = (season: string) =>
  TERM_COLORS.find((t) => season.toLowerCase().startsWith(t.term.toLowerCase()))?.term ?? null;

export default function RegHistoryCharts({ season, toggle, intro, charts }: {
  season: string;
  // The Final / To date switch, rendered by the server.
  toggle: ReactNode;
  // A note between the header and the charts, if any.
  intro?: ReactNode;
  charts: HistChart[];
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const toggleTerm = (term: string) =>
    setPicked((p) => (p.includes(term) ? p.filter((t) => t !== term) : [...p, term]));
  const shown = (bars: HistBar[]) => (picked.length ? bars.filter((b) => picked.includes(termOf(b.season) ?? "")) : bars);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {toggle}
        <TermKey picked={picked} onToggle={toggleTerm} onClear={() => setPicked([])} />
      </div>
      {intro}
      {charts.map((c) => (
        <HistoryChart key={c.title} title={c.title} noun={c.noun} subtitle={c.subtitle} season={season}
          format={c.format ?? (c.percent ? "percent" : "count")} currency={c.currency}
          bars={shown(c.bars)} all={c.bars} current={c.bars.find((b) => b.season === season)} />
      ))}
    </>
  );
}
