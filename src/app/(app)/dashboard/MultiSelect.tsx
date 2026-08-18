"use client";

import { useEffect, useRef, useState } from "react";

const CONTROL =
  "w-full min-w-[150px] rounded-lg border border-glass-border bg-glass-surface px-3 py-2 text-sm text-left flex items-center justify-between gap-2 focus:outline-none focus:border-glass-gold transition";

// Generic checkbox dropdown. An empty selection means "all" (the caller decides
// what that maps to). Options carry a value + label; value is what's emitted.
export function MultiSelect({
  options,
  value,
  onChange,
  allLabel = "All",
  singularNoun = "selected",
}: {
  options: { value: string; label: string }[];
  value: string[];
  onChange: (next: string[]) => void;
  allLabel?: string;
  singularNoun?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const selected = new Set(value);
  function toggle(v: string) {
    const next = new Set(selected);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(options.map((o) => o.value).filter((o) => next.has(o)));
  }

  const label =
    value.length === 0
      ? allLabel
      : value.length === 1
        ? (options.find((o) => o.value === value[0])?.label ?? value[0])
        : `${value.length} ${singularNoun}`;

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className={CONTROL}>
        <span className={value.length ? "text-glass-text truncate" : "text-glass-text-tertiary truncate"}>{label}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="shrink-0 text-glass-text-tertiary">
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-[200px] max-h-72 overflow-y-auto rounded-lg border border-glass-border-light py-1 shadow-lg" style={{ background: "var(--glass-background)" }}>
          <div className="flex items-center justify-between px-3 py-1.5">
            <span className="text-xs text-glass-text-secondary">{value.length} of {options.length}</span>
            <button type="button" className="text-xs text-glass-gold" onClick={() => onChange(value.length === options.length ? [] : options.map((o) => o.value))}>
              {value.length === options.length ? "Clear all" : "Select all"}
            </button>
          </div>
          {options.map((o) => {
            const on = selected.has(o.value);
            return (
              <button type="button" key={o.value} onClick={() => toggle(o.value)}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-left hover:bg-glass-surface-hover transition">
                <span className="w-4 h-4 rounded flex items-center justify-center shrink-0 border"
                  style={{ borderColor: on ? "var(--glass-gold)" : "var(--glass-border)", background: on ? "var(--glass-gold)" : "transparent" }}>
                  {on && <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5.5L4 7.5L8 3" stroke="black" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                </span>
                <span className="text-glass-text">{o.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
