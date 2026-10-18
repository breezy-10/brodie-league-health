"use client";

import { useEffect, useState } from "react";

type Item = { id: string; label: string };

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// A row of the dashboard's sections, each scrolling smoothly to its own. Read
// from the page rather than listed here: every section is a <section> with an
// <h2> title, the set changes with the view (season or weekly) and the scope,
// and they stream in one at a time, so the row follows the page as it fills.
export function SectionJumpBar({ containerId }: { containerId: string }) {
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    const root = document.getElementById(containerId);
    if (!root) return;
    const read = () => {
      const seen = new Set<string>();
      const next: Item[] = [];
      for (const sec of Array.from(root.querySelectorAll("section"))) {
        // Top-level sections only, and not the copies React keeps hidden
        // while a streamed section waits to be swapped in.
        if (sec.parentElement?.closest("section") || sec.closest("[hidden]")) continue;
        const label = sec.querySelector("h2")?.textContent?.trim();
        if (!label || seen.has(label)) continue;
        seen.add(label);
        if (!sec.id) sec.id = `section-${slug(label)}`;
        // Clear of the page header when scrolled to.
        if (!sec.style.scrollMarginTop) sec.style.scrollMarginTop = "calc(var(--shell-top) + 12px)";
        next.push({ id: sec.id, label });
      }
      setItems((prev) =>
        prev.length === next.length && prev.every((p, i) => p.id === next[i].id && p.label === next[i].label) ? prev : next);
    };
    read();
    const mo = new MutationObserver(read);
    mo.observe(root, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [containerId]);

  if (items.length < 2) return null;
  return (
    <nav aria-label="Jump to a section" className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs font-bold text-glass-text-tertiary mr-1">Jump to</span>
      {items.map((it) => (
        <button key={it.id} type="button" className="br-btn is-grey is-sm"
          onClick={() => document.getElementById(it.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}>
          {it.label}
        </button>
      ))}
    </nav>
  );
}
