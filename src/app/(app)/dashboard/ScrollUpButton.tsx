"use client";

import { ArrowUp } from "lucide-react";

// A round up-arrow that scrolls smoothly back to an element on the page: the
// Facility Bookings table's header bar uses it to return to the cards above
// after a chip has brought you down to a row.
export function ScrollUpButton({ targetId, label }: { targetId: string; label: string }) {
  return (
    <button type="button" aria-label={label} title={label}
      onClick={() => document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" })}
      className="inline-flex items-center justify-center rounded-full w-6 h-6 shrink-0 text-glass-text-secondary hover:text-glass-text transition-colors"
      style={{ background: "var(--fill-3)" }}>
      <ArrowUp size={14} strokeWidth={2.25} aria-hidden />
    </button>
  );
}

// "Back to top", beside a dashboard section's More details: scrolls smoothly
// to the very top of the page, where the Jump to row is.
export function BackToTopButton() {
  return (
    <button type="button" className="br-btn is-outline is-sm shrink-0"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
      Back to top ↑
    </button>
  );
}
