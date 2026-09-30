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
  searchable = false,
}: {
  options: { value: string; label: string }[];
  value: string[];
  onChange: (next: string[]) => void;
  allLabel?: string;
  singularNoun?: string;
  // A type-to-filter box at the top of the list — for long lists like the 46
  // locations, where scrolling to one is slower than typing it.
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // A fresh search each time the list opens.
  useEffect(() => { if (!open) setQuery(""); }, [open]);
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

  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  const shownSelected = shown.filter((o) => selected.has(o.value)).length;
  // With a search typed, the bulk button works on what's matching — "Boston"
  // then Select matching picks all five Boston venues.
  function bulk() {
    if (!q) {
      onChange(value.length === options.length ? [] : options.map((o) => o.value));
      return;
    }
    const all = shownSelected === shown.length;
    const next = new Set(selected);
    for (const o of shown) (all ? next.delete(o.value) : next.add(o.value));
    onChange(options.map((o) => o.value).filter((v) => next.has(v)));
  }
  const bulkLabel = q
    ? (shown.length && shownSelected === shown.length ? "Clear matching" : "Select matching")
    : (value.length === options.length ? "Clear all" : "Select all");

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
          {searchable && (
            <div className="sticky top-0 z-10 px-2 pt-1 pb-1.5" style={{ background: "var(--glass-background)" }}>
              <input
                autoFocus
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { e.preventDefault(); if (query) setQuery(""); else setOpen(false); }
                  // Enter picks the only match, so "oak" + Enter selects Oakville.
                  if (e.key === "Enter") { e.preventDefault(); if (shown.length === 1) toggle(shown[0].value); }
                }}
                placeholder={`Search ${singularNoun}`}
                aria-label={`Search ${singularNoun}`}
                className="w-full rounded-md border border-glass-border bg-glass-surface px-2.5 py-1.5 text-sm text-glass-text placeholder:text-glass-text-tertiary focus:outline-none focus:border-glass-gold"
              />
            </div>
          )}
          <div className="flex items-center justify-between px-3 py-1.5">
            <span className="text-xs text-glass-text-secondary">
              {value.length} of {options.length}{q ? ` · ${shown.length} matching` : ""}
            </span>
            <button type="button" className="text-xs text-glass-gold disabled:opacity-40" disabled={!shown.length} onClick={bulk}>
              {bulkLabel}
            </button>
          </div>
          {q && shown.length === 0 && (
            <p className="px-3 py-2 text-sm italic text-glass-text-tertiary">No {singularNoun} match &ldquo;{query.trim()}&rdquo;</p>
          )}
          {shown.map((o) => {
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
