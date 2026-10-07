"use client";

import { useState } from "react";

export function RefreshButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setMsg("Syncing all apps...");
    try {
      const res = await fetch("/api/admin/refresh", { method: "POST" });
      const j = (await res.json()) as { ok?: boolean; report?: Array<{ app: string; status: string; rows: number }>; scored?: { computed: number } };
      if (j.ok) {
        const ok = (j.report ?? []).filter((r) => r.status === "success").length;
        setMsg(`Synced ${ok} app${ok === 1 ? "" : "s"} · scored ${j.scored?.computed ?? 0} LMs`);
        setTimeout(() => window.location.reload(), 800);
      } else {
        setMsg("Refresh failed.");
      }
    } catch (e: unknown) {
      setMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={refresh}
        disabled={busy}
        className="text-sm px-3.5 py-2 rounded-full bg-glass-gold text-[color:var(--on-ink)] font-semibold disabled:opacity-50 hover:opacity-90 transition"
      >
        {busy ? "Refreshing..." : "Refresh now"}
      </button>
      {msg && <span className="text-xs text-glass-text-tertiary">{msg}</span>}
    </div>
  );
}
