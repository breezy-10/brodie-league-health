"use client";

import { useState } from "react";

type Tone = "default" | "ok" | "warn" | "bad";
type Tile = {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  // Render `sub` beside the value instead of on its own line below it.
  subInline?: boolean;
  // Sits just after the unit, in the value's own colour — a ratio read as a share.
  valueSuffix?: string;
  lines?: { text: string; strong?: boolean; chip?: boolean; pill?: { text: string; ok: boolean }; after?: string; color?: string; afterColor?: string }[];
  tone?: Tone;
  link?: { href: string; label: string };
  // A second headline number on the right of the same card, set at the same
  // size as the main value, with its own small label and follow-up lines.
  corner?: { label: string; value: string; color?: string; lines?: { text: string; color?: string }[] };
  // Named items behind the number — rendered as wrapped chips, tinted by tone.
  // sortValue is what "largest first" means for that chip — a count, a share,
  // a balance, an elapsed time. Without it a chip can only be ordered A-Z,
  // since the number is inside its text.
  pills?: (string | { text: string; tone?: Tone; sortValue?: number })[];
  pillsEmpty?: string;
  // Defaults to the card's tone; set when the chips mean something different
  // from the headline (an amber card listing red gaps).
  pillTone?: Tone;
};

export type { Tile, Tone };

const PILL_STYLES: Record<string, { color: string; borderColor: string; background?: string }> = {
  bad: { color: "rgb(248,113,113)", borderColor: "rgba(239,68,68,0.35)", background: "rgba(239,68,68,0.10)" },
  warn: { color: "var(--glass-gold)", borderColor: "rgba(255,184,0,0.35)", background: "rgba(255,184,0,0.10)" },
  ok: { color: "rgb(74,222,128)", borderColor: "rgba(74,222,128,0.35)", background: "rgba(74,222,128,0.10)" },
  default: { color: "var(--glass-text-secondary)", borderColor: "var(--glass-border)" },
};

// A client component for one reason: the A-Z / Largest control in its corner
// orders the chips in its body, and the two have to share a piece of state.
// Every prop is plain data, so the server components that render it are
// unaffected.
export default function StatTile({ label, value, unit, valueSuffix, sub, subInline, lines, tone = "default", link, pills, pillsEmpty, pillTone, corner }: Tile) {
  const [order, setOrder] = useState<"az" | "size">("az");
  // Normalised once: a chip can be given as a bare string.
  const chips = pills?.map((p) => (typeof p === "string" ? { text: p } : p));
  // Nothing to sort by on a list of bare names, so it is left alone and the
  // control stays off the card.
  const sortable = !!chips && chips.length > 1 && chips.some((p) => p.sortValue != null);
  const shown = order === "size" && sortable
    ? [...chips!].sort((a, b) => (b.sortValue ?? -Infinity) - (a.sortValue ?? -Infinity))
    : chips ?? [];
  const color =
    tone === "ok" ? "rgb(74,222,128)" :
    tone === "warn" ? "var(--glass-gold)" :
    tone === "bad" ? "rgb(248,113,113)" : "var(--glass-text)";
  return (
    // h-full + column, so a card carrying a button can push it to the floor
    // rather than leaving it wherever the content above happened to end.
    <div className="rounded-xl border border-glass-border bg-glass-surface px-4 py-3.5 min-w-0 h-full flex flex-col">
      {/* The corner shares the card's rows rather than stacking beside them:
          its label sits on the label row, its value on the value row, and its
          follow-up lines on the first lines below. */}
      <div className="flex items-start justify-between gap-3">
        <div className="text-[11px] sm:text-[10px] uppercase tracking-[0.16em] font-bold text-glass-text-tertiary truncate pt-0.5">{label}</div>
        {/* Top right, on the title's line: the order is a property of the card,
            so it reads as part of the card's furniture rather than as something
            wedged between the numbers and the chips. Only where there is
            something to sort by — two or more chips carrying a magnitude. */}
        {sortable && (
          <div className="inline-flex items-center rounded-lg border p-0.5 shrink-0" style={{ borderColor: "var(--glass-border)" }}>
            {([["az", "A–Z"], ["size", "Largest"]] as const).map(([v, text]) => (
              <button key={v} type="button" onClick={() => setOrder(v)}
                className="px-2 py-0.5 rounded-md transition"
                style={{
                  fontSize: 10, fontWeight: 600, border: "none",
                  cursor: order === v ? "default" : "pointer",
                  background: order === v ? "var(--glass-gold)" : "transparent",
                  color: order === v ? "#000" : "var(--glass-text-tertiary)",
                }}>
                {text}
              </button>
            ))}
          </div>
        )}
        {corner && (
          <div className="text-[11px] sm:text-[10px] uppercase tracking-[0.16em] font-bold text-glass-text-tertiary shrink-0">{corner.label}</div>
        )}
      </div>
      <div className="mt-1.5 flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-1.5">
          <span className="text-2xl font-bold tabular" style={{ color }}>{value}</span>
          {unit && <span className="text-sm text-glass-text-tertiary">{unit}</span>}
          {valueSuffix && <span className="text-base font-bold tabular" style={{ color }}>{valueSuffix}</span>}
          {sub && subInline && <span className="text-[11px] text-glass-text-tertiary leading-snug">{sub}</span>}
        </div>
        {corner && (
          <span className="text-2xl font-bold tabular shrink-0" style={{ color: corner.color ?? "var(--glass-text)" }}>{corner.value}</span>
        )}
      </div>
      {sub && !subInline && <div className="text-[11px] text-glass-text-tertiary mt-1 leading-snug">{sub}</div>}
      {((lines?.length ?? 0) > 0 || (corner?.lines?.length ?? 0) > 0) && (
        <div className="mt-2 space-y-0.5 tabular">
          {Array.from({ length: Math.max(lines?.length ?? 0, corner?.lines?.length ?? 0) }).map((_, i) => {
            const l = lines?.[i];
            const c = corner?.lines?.[i];
            return (
            // One size for every row, on both sides of a card and across the
            // row of cards — a card with a corner used to shrink its paired rows.
            <div key={i} className="text-xs leading-snug flex items-baseline gap-2">
            <div
              className="flex items-center gap-1.5 flex-wrap min-w-0"
              style={{ color: l?.color ?? (l?.strong ? "var(--glass-text)" : "var(--glass-text-tertiary)"), fontWeight: l?.strong ? 600 : 400 }}
            >
              {l && (l.chip
                ? <span className="text-[11px] sm:text-[10px] font-semibold rounded-md px-1.5 py-0.5 border whitespace-nowrap"
                    style={{ color: "var(--glass-gold)", borderColor: "rgba(255,184,0,0.35)", background: "rgba(255,184,0,0.10)" }}>
                    {l.text}
                  </span>
                : <span>{l.text}</span>)}
              {l?.pill && (
                <span
                  className="text-[11px] sm:text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                  style={{
                    color: l.pill.ok ? "rgb(74,222,128)" : "rgb(248,113,113)",
                    background: l.pill.ok ? "rgba(34,197,94,0.14)" : "rgba(239,68,68,0.14)",
                  }}
                >
                  {l.pill.text}
                </span>
              )}
              {l?.after && (
                <span className="font-normal" style={{ color: l.afterColor ?? "var(--glass-text-tertiary)" }}>{l.after}</span>
              )}
            </div>
            {c && (
              <span className="ml-auto text-xs tabular whitespace-nowrap shrink-0"
                style={{ color: c.color ?? "var(--glass-text-tertiary)" }}>{c.text}</span>
            )}
            </div>
            );
          })}
        </div>
      )}
      {chips && (
        chips.length === 0
          ? (pillsEmpty ? <div className="mt-2 text-[11px] italic text-glass-text-tertiary">{pillsEmpty}</div> : null)
          : (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {shown.map((p) => {
                const st = PILL_STYLES[p.tone ?? pillTone ?? tone ?? "default"] ?? PILL_STYLES.default;
                return (
                  <span key={p.text} className="text-[11px] rounded-md px-1.5 py-0.5 border max-w-full" style={st}>
                    {p.text}
                  </span>
                );
              })}
            </div>
          )
      )}
      {link && (
        <div className="mt-auto pt-3 flex justify-end">
          <a href={link.href} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center rounded-md border border-glass-gold px-2.5 py-1 text-[11px] sm:text-[10px] uppercase tracking-[0.14em] font-bold text-glass-gold hover:bg-glass-gold hover:text-black transition-colors">
            {link.label}
          </a>
        </div>
      )}
    </div>
  );
}

