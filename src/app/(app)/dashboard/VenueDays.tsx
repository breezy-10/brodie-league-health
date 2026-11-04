"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

// A venue on the location strip that plays more than one day opens into a card
// per day, in its own place in the strip, and closes back again. Both sides are
// rendered on the server; this only switches which one shows. The wrappers are
// display: contents so every card stays a direct item of the strip's grid,
// which is what lets the cards share their row heights through subgrid.
const Open = createContext<{ open: boolean; toggle: () => void } | null>(null);

export function VenueDays({ venue, days }: { venue: ReactNode; days: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Open.Provider value={{ open, toggle: () => setOpen((o) => !o) }}>
      <div className={open ? "hidden" : "contents"}>{venue}</div>
      <div className={open ? "contents" : "hidden"}>{days}</div>
    </Open.Provider>
  );
}

// The switch, on the venue card ("Show 3 days") and on each of its day cards
// ("Hide days").
export function VenueDaysButton({ name, count }: { name: string; count: number }) {
  const ctx = useContext(Open);
  if (!ctx) return null;
  return (
    <button type="button" onClick={ctx.toggle} aria-expanded={ctx.open}
      aria-label={`${ctx.open ? "Hide" : "Show"} ${name} by day`}
      className="text-[11px] font-semibold hover:brightness-110 transition"
      style={{ color: "var(--glass-text-secondary)" }}>
      {ctx.open ? "← Hide days" : `Show ${count} days →`}
    </button>
  );
}
