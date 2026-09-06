"use client";

import { useState } from "react";
import { severityDot } from "@/lib/colors";

export function ActionItemRow({
  id,
  title,
  detail,
  severity,
  appName,
  resolvedAt,
  readOnly = false,
  xpReward = 0,
}: {
  id: string;
  title: string;
  detail: string | null;
  severity: string;
  appName: string;
  resolvedAt: string | null;
  readOnly?: boolean;
  /** XP awarded to the LM when they click Done (0 = no reward, just informational). */
  xpReward?: number;
}) {
  const [done, setDone] = useState(!!resolvedAt);
  const [busy, setBusy] = useState(false);

  async function markDone() {
    setBusy(true);
    const res = await fetch("/api/me/action-resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) {
      setDone(true);
      if (xpReward > 0) {
        // Soft reload so the new XP shows in the score card without
        // a full page flash. Same trick admin Refresh uses.
        setTimeout(() => window.location.reload(), 300);
      }
    }
    setBusy(false);
  }

  return (
    <li
      className={`flex items-start gap-3 rounded-xl border border-glass-border bg-glass-surface p-3 ${
        done ? "opacity-50" : ""
      }`}
    >
      <span className={`mt-1.5 inline-block w-2.5 h-2.5 rounded-full ${severityDot(severity)}`} />
      <div className="flex-1">
        <p className={`text-sm ${done ? "line-through text-glass-text-secondary" : ""}`}>{title}</p>
        {detail && <p className="text-xs text-glass-text-secondary mt-1">{detail}</p>}
        <p className="text-[11px] sm:text-[10px] uppercase tracking-wider text-glass-text-tertiary mt-1 font-semibold">
          {appName}
        </p>
      </div>

      {xpReward > 0 && !done && (
        <span
          className="self-center text-xs font-semibold px-2 py-1 rounded-md"
          style={{
            background: "rgba(255, 184, 0, 0.12)",
            color: "var(--glass-gold)",
            border: "1px solid rgba(255, 184, 0, 0.4)",
          }}
        >
          +{xpReward} XP
        </span>
      )}

      {!done && (
        <button
          onClick={markDone}
          disabled={busy || readOnly}
          className="text-xs px-2.5 py-1 rounded-md border border-glass-border bg-[var(--input-bg)] hover:bg-glass-surface-hover disabled:opacity-50 transition"
        >
          {busy ? "..." : "Done"}
        </button>
      )}
    </li>
  );
}
