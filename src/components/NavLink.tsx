"use client";

import Link from "next/link";
import { RouteProgressBar } from "@/components/RouteProgressBar";
import { usePathname } from "next/navigation";

export function NavLink({ href, label, exact = false }: { href: string; label: string; exact?: boolean }) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");

  return (
    <Link
      href={href}
      className="relative flex items-center h-full px-3.5"
      style={{
        fontSize: 13,
        fontWeight: 600,
        color: active ? "var(--glass-text)" : "var(--glass-text-tertiary)",
        textDecoration: "none",
        transition: "color 120ms ease",
      }}
      onMouseEnter={(e) => {
        if (!active) (e.currentTarget as HTMLAnchorElement).style.color = "var(--glass-text-secondary)";
      }}
      onMouseLeave={(e) => {
        if (!active) (e.currentTarget as HTMLAnchorElement).style.color = "var(--glass-text-tertiary)";
      }}
    >
      {label}
      <RouteProgressBar />
      {active && (
        <span
          className="absolute bottom-0"
          style={{
            left: 14,
            right: 14,
            height: 2,
            borderRadius: "2px 2px 0 0",
            background: "var(--glass-gold)",
          }}
        />
      )}
    </Link>
  );
}
