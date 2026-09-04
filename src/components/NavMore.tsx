"use client";

import Link from "next/link";
import { RouteProgressBar } from "@/components/RouteProgressBar";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export type MoreItem = { href: string; label: string; exact?: boolean };

const isActive = (pathname: string, item: MoreItem) =>
  item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + "/");

// Secondary nav destinations folded into one dropdown so the main bar stays
// short. Reads as active whenever the current page is one of its items.
export function NavMore({ items, label = "More" }: { items: MoreItem[]; label?: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const active = items.some((i) => isActive(pathname, i));

  // The nav bar scrolls horizontally (overflow-x), which would clip an
  // absolutely-positioned menu — so the panel is fixed and positioned from the
  // button's measured rect instead.
  function place() {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ left: r.left, top: r.bottom });
  }
  useEffect(() => {
    if (!open) return;
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  // A navigation keeps the menu mounted, so close it when the route changes.
  useEffect(() => { setOpen(false); }, [pathname]);

  if (items.length === 0) return null;

  return (
    <div ref={ref} className="relative flex items-stretch">
      <button
        ref={btnRef}
        type="button"
        onClick={() => { place(); setOpen((o) => !o); }}
        aria-haspopup="menu"
        aria-expanded={open}
        className="relative flex items-center h-full px-3.5 gap-1.5"
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: active || open ? "var(--glass-text)" : "var(--glass-text-tertiary)",
          background: "none",
          border: "none",
          cursor: "pointer",
          whiteSpace: "nowrap",
          transition: "color 120ms ease",
        }}
      >
        {label}
        <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden
          style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 120ms ease" }}>
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {active && (
          <span
            className="absolute bottom-0"
            style={{ left: 14, right: 14, height: 2, borderRadius: "2px 2px 0 0", background: "var(--glass-gold)" }}
          />
        )}
      </button>

      {open && pos && (
        <div
          role="menu"
          className="fixed z-50 rounded-lg border py-1 shadow-lg"
          style={{
            top: pos.top,
            left: pos.left,
            minWidth: 190,
            background: "var(--glass-background)",
            borderColor: "var(--glass-border-light)",
          }}
        >
          {items.map((item) => {
            const on = isActive(pathname, item);
            return (
              <Link
                key={item.href}
                href={item.href}
                role="menuitem"
                className="block px-3.5 py-2 hover:bg-glass-surface-hover transition"
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: on ? "var(--glass-gold)" : "var(--glass-text-secondary)",
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                }}
              >
                {item.label}
                <RouteProgressBar />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
