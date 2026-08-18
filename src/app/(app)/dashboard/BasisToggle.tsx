"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";

// Segmented control that flips one URL param between two values. Used in
// Weekly Review to read the registration cards on a season or a week basis.
export function BasisToggle({
  param,
  value,
  options,
}: {
  param: string;
  value: string;
  options: { value: string; label: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();

  function pick(next: string) {
    if (next === value) return;
    const q = new URLSearchParams(search.toString());
    // The first option is the default, so it stays out of the URL.
    if (next === options[0].value) q.delete(param);
    else q.set(param, next);
    const qs = q.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  }

  return (
    <div
      className="inline-flex items-center rounded-lg border p-0.5 shrink-0"
      style={{ borderColor: "var(--glass-border)", opacity: pending ? 0.6 : 1 }}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => pick(o.value)}
            className="px-2.5 py-1 rounded-md transition"
            style={{
              fontSize: 11,
              fontWeight: 600,
              cursor: on ? "default" : "pointer",
              border: "none",
              background: on ? "var(--glass-gold)" : "transparent",
              color: on ? "#000" : "var(--glass-text-tertiary)",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
