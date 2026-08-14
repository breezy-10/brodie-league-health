"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Option = { id: string; full_name: string; location_name: string | null };

export function ViewAsBanner({ name, options }: { name: string; options: Option[] }) {
  return (
    <div className="rounded-2xl border border-glass-gold/40 bg-glass-gold/10 p-3 flex flex-wrap items-center gap-3">
      <span className="text-xs uppercase tracking-wider text-glass-gold font-semibold px-2 py-1 rounded bg-glass-surface-hover">
        Viewing as
      </span>
      <span className="font-semibold">{name}</span>
      <div className="flex items-center gap-2 ml-auto">
        <ViewAsSwitcher options={options} compact />
        <Link
          href="/my-day"
          className="text-xs px-3 py-1.5 rounded-md border border-glass-border bg-[var(--input-bg)] hover:bg-glass-surface-hover transition"
        >
          Back to my day
        </Link>
      </div>
    </div>
  );
}

export function ViewAsSwitcher({ options, compact = false }: { options: Option[]; compact?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState<string>("");

  function go(id: string) {
    setValue(id);
    if (!id) return;
    startTransition(() => {
      router.push(`/my-day?lm=${id}`);
    });
  }

  return (
    <select
      value={value}
      onChange={(e) => go(e.target.value)}
      disabled={pending}
      className={`border rounded-md text-xs px-2 py-1.5 focus:outline-none focus:border-glass-gold ${
        compact ? "" : "w-full"
      }`}
      style={{
        background: "var(--input-bg)",
        color: "var(--glass-text)",
        borderColor: "var(--glass-border)",
      }}
    >
      <option value="">{pending ? "Loading..." : "Pick an LM..."}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.full_name}
          {o.location_name ? ` — ${o.location_name}` : ""}
        </option>
      ))}
    </select>
  );
}
