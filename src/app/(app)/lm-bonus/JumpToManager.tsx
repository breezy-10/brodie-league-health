"use client";

import { useEffect, type ReactNode } from "react";
import { managerCardId } from "./card-id";

// Clicking a league manager in the LM bonus table opens their card below and
// scrolls to it (Sohaib, Nov 15). A native <details> doesn't open when a link
// points at it, so this opens it; the card's scroll-margin keeps it clear of
// the sticky header. A link to /lm-bonus#lm-<name> opens that card too.

function openCard(id: string, smooth: boolean) {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLDetailsElement)) return;
  el.open = true;
  el.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
}

export function JumpLink({ name, children }: { name: string; children: ReactNode }) {
  const id = managerCardId(name);
  return (
    <a href={`#${id}`} className="hover:underline"
      onClick={(e) => {
        e.preventDefault();
        history.replaceState(null, "", `#${id}`);
        openCard(id, true);
      }}>
      {children}
    </a>
  );
}

/** Opens the card the page's link names, on arrival. */
export function OpenCardFromHash() {
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (id.startsWith("lm-")) openCard(id, false);
  }, []);
  return null;
}
