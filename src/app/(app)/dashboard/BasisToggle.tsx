"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";

// Where the toggle that was just clicked sat on screen: which one (its param,
// and which of the toggles with that param) and how far from the top of the
// window. Shared by every toggle on the page, since whichever re-renders first
// after the new page commits puts the clicked one back.
let keepAt: { param: string; index: number; top: number } | null = null;

// Segmented control that flips one URL param between two values. Used in
// Weekly Review to read the registration cards on a season or a week basis.
export function BasisToggle({
  param,
  value,
  options,
  defaultValue,
  clearOn,
}: {
  param: string;
  value: string;
  options: { value: string; label: string }[];
  // The value that stays out of the URL. Defaults to the first option, which is
  // usually also the default state, but not always: season toggles list the
  // newer season first whichever one the section opens on.
  defaultValue?: string;
  // Other params to drop when a value is picked, e.g. the location filter
  // when switching to a view that compares every location.
  clearOn?: Record<string, string[]>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  const searchKey = search.toString();

  // Next scrolls to the top when the new page commits even with scroll: false
  // (its scroll handler runs anyway; seen on Next 15.5 with the dashboard's
  // loading screen), so put the clicked toggle back where it was on screen.
  // A passive effect runs after that handler, so this has the last word, and
  // anchoring on the toggle rather than the old scroll position keeps its
  // section in view even when the sections above it change height.
  useEffect(() => {
    if (!keepAt) return;
    const at = keepAt;
    keepAt = null;
    const el = document.querySelectorAll<HTMLElement>(`[data-basis-param="${at.param}"]`)[at.index];
    if (el) window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - at.top);
  }, [searchKey]);

  function pick(next: string) {
    if (next === value) return;
    const q = new URLSearchParams(search.toString());
    for (const k of clearOn?.[next] ?? []) q.delete(k);
    // The default stays out of the URL.
    if (next === (defaultValue ?? options[0].value)) q.delete(param);
    else q.set(param, next);
    const qs = q.toString();
    const el = ref.current;
    keepAt = el
      ? { param, index: [...document.querySelectorAll(`[data-basis-param="${param}"]`)].indexOf(el), top: el.getBoundingClientRect().top }
      : null;
    // scroll: false — this is a filter for one section, not a new page. The
    // default push throws you back to the top, which on a long dashboard means
    // losing the section you were reading to change what it says.
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  return (
    <div ref={ref} data-basis-param={param} className="br-seg items-center" style={{ opacity: pending ? 0.6 : 1 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => pick(o.value)}
            className={on ? "is-on" : undefined}
            aria-pressed={on}
            style={{ cursor: on ? "default" : "pointer" }}
          >
            {o.label}
          </button>
        );
      })}
      {/* The section it drives is streamed in behind a Suspense boundary, so
          without this the only sign a click landed is the card contents
          changing some time later. */}
      {pending && (
        <span
          role="status"
          aria-label="Loading"
          className="mx-1.5 inline-block h-3 w-3 shrink-0 animate-spin rounded-full"
          style={{ border: "2px solid var(--glass-border)", borderTopColor: "var(--ink)" }}
        />
      )}
    </div>
  );
}
