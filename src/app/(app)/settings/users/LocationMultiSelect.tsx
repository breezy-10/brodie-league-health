"use client";

import { useEffect, useRef, useState } from "react";

const CONTROL =
  "w-full rounded-lg border border-glass-border bg-glass-surface px-3 py-2 text-sm text-left flex items-center justify-between gap-2 focus:outline-none focus:border-glass-gold transition";

export function LocationMultiSelect({
  options,
  value,
  onChange,
  placeholder = "Select locations",
}: {
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
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
  function toggle(loc: string) {
    const next = new Set(selected);
    if (next.has(loc)) next.delete(loc);
    else next.add(loc);
    onChange(options.filter((o) => next.has(o)));
  }

  const label =
    value.length === 0
      ? placeholder
      : value.length <= 2
        ? value.join(", ")
        : `${value.length} locations`;

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className={CONTROL}>
        <span className={value.length ? "text-glass-text truncate" : "text-glass-text-tertiary"}>{label}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="shrink-0 text-glass-text-tertiary">
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          className="absolute z-30 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border border-glass-border-light py-1 shadow-lg"
          style={{ background: "var(--glass-background)" }}
        >
          {options.length === 0 ? (
            <p className="px-3 py-2 text-xs text-glass-text-tertiary">No locations available.</p>
          ) : (
            options.map((loc) => {
              const on = selected.has(loc);
              return (
                <button
                  type="button"
                  key={loc}
                  onClick={() => toggle(loc)}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-left hover:bg-glass-surface-hover transition"
                >
                  <span
                    className="w-4 h-4 rounded flex items-center justify-center shrink-0 border"
                    style={{
                      borderColor: on ? "var(--glass-gold)" : "var(--glass-border)",
                      background: on ? "var(--glass-gold)" : "transparent",
                    }}
                  >
                    {on && (
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M2 5.5L4 7.5L8 3" stroke="black" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  <span className="text-glass-text">{loc}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
