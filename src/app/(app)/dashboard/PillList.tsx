"use client";

import { useState } from "react";

export type Pill = { text: string; tone?: "ok" | "warn" | "bad" | "default"; sortValue?: number };

const STYLES: Record<string, { color: string; borderColor: string; background?: string }> = {
  bad: { color: "rgb(248,113,113)", borderColor: "rgba(239,68,68,0.35)", background: "rgba(239,68,68,0.10)" },
  warn: { color: "var(--glass-gold)", borderColor: "rgba(255,184,0,0.35)", background: "rgba(255,184,0,0.10)" },
  ok: { color: "rgb(74,222,128)", borderColor: "rgba(74,222,128,0.35)", background: "rgba(74,222,128,0.10)" },
  default: { color: "var(--glass-text-secondary)", borderColor: "var(--glass-border)" },
};

/**
 * The chip list on a card, and the control that orders it.
 *
 * A-Z by default, so a venue sits where you expect it; largest first when the
 * question is who is worst. The order is a way of reading, not a filter — it
 * changes nothing about what the card is showing — so it lives in component
 * state rather than the URL: instant, and it does not re-run the page for
 * twenty other cards that were fine as they were.
 */
export default function PillList({ pills, fallbackTone = "default", empty }: {
  pills: Pill[];
  fallbackTone?: Pill["tone"];
  empty?: string;
}) {
  const [order, setOrder] = useState<"az" | "size">("az");
  if (pills.length === 0) {
    return empty ? <div className="mt-2 text-[11px] italic text-glass-text-tertiary">{empty}</div> : null;
  }
  // Nothing to sort by on a list of bare names, so it is left alone.
  const sortable = pills.length > 1 && pills.some((p) => p.sortValue != null);
  const shown = order === "size" && sortable
    ? [...pills].sort((a, b) => (b.sortValue ?? -Infinity) - (a.sortValue ?? -Infinity))
    : pills;

  return (
    <div className="mt-2">
      {sortable && (
        <div className="flex justify-end mb-1.5">
          <div className="inline-flex items-center rounded-lg border p-0.5" style={{ borderColor: "var(--glass-border)" }}>
            {([["az", "A–Z"], ["size", "Largest"]] as const).map(([v, label]) => (
              <button key={v} type="button" onClick={() => setOrder(v)}
                className="px-2 py-0.5 rounded-md transition"
                style={{
                  fontSize: 10, fontWeight: 600, border: "none",
                  cursor: order === v ? "default" : "pointer",
                  background: order === v ? "var(--glass-gold)" : "transparent",
                  color: order === v ? "#000" : "var(--glass-text-tertiary)",
                }}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {shown.map((p) => {
          const style = STYLES[p.tone ?? fallbackTone ?? "default"] ?? STYLES.default;
          return (
            <span key={p.text} className="text-[11px] rounded-md px-1.5 py-0.5 border max-w-full" style={style}>
              {p.text}
            </span>
          );
        })}
      </div>
    </div>
  );
}
