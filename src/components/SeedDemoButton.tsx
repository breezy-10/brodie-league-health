"use client";

import { useState } from "react";

export function SeedDemoButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function seed() {
    if (!confirm("Wipe any existing demo LMs and seed 6 fresh personas with 14 days of data?")) return;
    setBusy(true);
    setMsg("Seeding...");
    const res = await fetch("/api/admin/seed-demo", { method: "POST" });
    const j = (await res.json()) as { ok?: boolean; lms?: number; snapshots?: number; actions?: number; error?: string };
    if (j.ok) {
      setMsg(`✓ ${j.lms} LMs, ${j.snapshots} snapshots, ${j.actions} action items.`);
      setTimeout(() => window.location.reload(), 800);
    } else {
      setMsg(`Error: ${j.error ?? "unknown"}`);
    }
    setBusy(false);
  }

  return (
    <div className="rounded-2xl bg-glass-surface p-5 space-y-2 shadow-card">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold">Seed demo data</h2>
          <p className="text-xs text-glass-text-tertiary mt-0.5">
            6 fake LMs · 14 days of scores · gamification computed. Use <span className="font-mono">@brodierec.local</span> emails so they wipe cleanly.
          </p>
        </div>
        <button
          onClick={seed}
          disabled={busy}
          className="text-sm px-3.5 py-2 rounded-full bg-glass-gold text-[color:var(--on-ink)] font-semibold disabled:opacity-50 hover:opacity-90 transition"
        >
          {busy ? "Seeding..." : "Seed demo data"}
        </button>
      </div>
      {msg && <p className="text-xs text-glass-text-tertiary">{msg}</p>}
    </div>
  );
}
