"use client";

import { createContext, useContext, useState } from "react";

// A search the box beside the view toggle sets and the discount table reads,
// so typing narrows the list at once instead of waiting on a page load.
const SearchContext = createContext<{ q: string; setQ: (v: string) => void }>({ q: "", setQ: () => {} });

export function SearchProvider({ children }: { children: React.ReactNode }) {
  const [q, setQ] = useState("");
  return <SearchContext.Provider value={{ q, setQ }}>{children}</SearchContext.Provider>;
}

// The search, trimmed and lower-cased; empty when nothing is typed.
export function useTeamSearch(): string {
  return useContext(SearchContext).q.trim().toLowerCase();
}

export function TeamSearchBox({ placeholder }: { placeholder: string }) {
  const { q, setQ } = useContext(SearchContext);
  return (
    <input
      type="search"
      className="br-search"
      value={q}
      onChange={(e) => setQ(e.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
    />
  );
}
