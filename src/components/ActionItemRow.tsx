"use client";

import { useState } from "react";

export function ActionItemRow({
  id,
  title,
  detail,
  severity,
  appName,
  resolvedAt,
}: {
  id: string;
  title: string;
  detail: string | null;
  severity: string;
  appName: string;
  resolvedAt: string | null;
}) {
  const [done, setDone] = useState(!!resolvedAt);
  const [busy, setBusy] = useState(false);

  const dot =
    severity === "critical" ? "bg-brodie-bad" :
    severity === "high"     ? "bg-brodie-warn" :
    severity === "medium"   ? "bg-yellow-300" :
                              "bg-brodie-dim";

  async function markDone() {
    setBusy(true);
    const res = await fetch("/api/me/action-resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) setDone(true);
    setBusy(false);
  }

  return (
    <li className={`flex items-start gap-3 rounded-lg border border-brodie-line p-3 ${done ? "opacity-50" : ""}`}>
      <span className={`mt-1 inline-block w-2.5 h-2.5 rounded-full ${dot}`} />
      <div className="flex-1">
        <p className={`text-sm ${done ? "line-through" : ""}`}>{title}</p>
        {detail && <p className="text-xs text-brodie-dim mt-1">{detail}</p>}
        <p className="text-[10px] uppercase tracking-wider text-brodie-dim mt-1">{appName}</p>
      </div>
      {!done && (
        <button
          onClick={markDone}
          disabled={busy}
          className="text-xs px-2 py-1 rounded border border-brodie-line hover:bg-brodie-line disabled:opacity-50"
        >
          {busy ? "..." : "Done"}
        </button>
      )}
    </li>
  );
}
