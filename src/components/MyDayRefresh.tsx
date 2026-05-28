"use client";

import { useState } from "react";

/**
 * Small "Refresh" button for the LM on My Day. Pings /api/me/refresh
 * which does a full sync + rescore (idempotent). On success, reload the
 * page so the LM sees the new numbers without a hard refresh.
 */
export function MyDayRefresh() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setMsg("Pulling fresh numbers...");
    try {
      const res = await fetch("/api/me/refresh", { method: "POST" });
      if (res.ok) {
        setMsg("Done. Reloading...");
        setTimeout(() => window.location.reload(), 500);
      } else {
        setMsg("Refresh failed. Try again in a few seconds.");
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
        className="text-xs px-3 py-1.5 rounded-full transition disabled:opacity-50"
        style={{
          background: "var(--bg-raised)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          fontWeight: 600,
        }}
      >
        {busy ? "Syncing..." : "↻ Refresh"}
      </button>
      {msg && <span className="text-[10px]" style={{ color: "var(--text-mute)" }}>{msg}</span>}
    </div>
  );
}
