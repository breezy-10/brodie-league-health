"use client";

import { useState } from "react";
import { scoreColor, severityDot } from "@/lib/colors";
import { APP_DEEP_LINKS } from "@/lib/app-urls";

export type ActionItem = {
  id: string;
  title: string;
  detail: string | null;
  severity: string;
  resolved_at: string | null;
  xpReward: number;
};

/**
 * Dense per-app tile. Built for scannable "what's my number / what's
 * blocking me / where do I go" reads. Top 2 action items visible inline,
 * the rest tucked behind a "+N more" expander.
 */
export function AppCard({
  appSlug,
  appName,
  score,
  max,
  actions,
}: {
  appSlug: string;
  appName: string;
  score: number;
  max: number;
  actions: ActionItem[];
  readOnly?: boolean; // accepted for API compat; ignored now (no read-only badge)
}) {
  const [expanded, setExpanded] = useState(false);
  const pct = max > 0 ? Math.round((score / max) * 100) : 0;
  const deepLink = APP_DEEP_LINKS[appSlug];
  const openActions = actions.filter((a) => !a.resolved_at);
  const visibleActions = expanded ? openActions : openActions.slice(0, 2);
  const hiddenCount = openActions.length - visibleActions.length;

  return (
    <section
      className="rounded-2xl border p-4 brodie-card"
      style={{
        background: "var(--bg-raised)",
        borderColor: "var(--border)",
      }}
    >
      {/* Top row: app name + Lock in */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <p
          className="uppercase text-[10px] tracking-[0.08em] font-semibold leading-tight"
          style={{ color: "var(--text-mute)" }}
        >
          {appName}
        </p>
        {deepLink && (
          <a
            href={deepLink.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full transition"
            style={{
              background: "var(--accent-soft)",
              color: "var(--accent)",
              border: "1px solid rgba(242, 169, 0, 0.5)",
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            Lock in →
          </a>
        )}
      </div>

      {/* Score block: big number, small max */}
      <div className="flex items-baseline gap-2">
        <span className={`text-2xl font-semibold tracking-tight ${scoreColor(pct)}`}>
          {Math.round(score)}
        </span>
        <span className="text-xs" style={{ color: "var(--text-mute)" }}>
          / {Math.round(max)} pts · {pct}%
        </span>
      </div>

      {/* Action items — tight, max 2 visible, expander for the rest */}
      {openActions.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {visibleActions.map((a) => (
            <ActionItemInline key={a.id} item={a} />
          ))}
          {!expanded && hiddenCount > 0 && (
            <li>
              <button
                onClick={() => setExpanded(true)}
                className="text-[11px] font-semibold uppercase tracking-wider hover:underline"
                style={{ color: "var(--text-mute)" }}
              >
                +{hiddenCount} more
              </button>
            </li>
          )}
        </ul>
      )}
      {openActions.length === 0 && actions.length > 0 && (
        <p className="text-[11px] mt-2 italic" style={{ color: "var(--text-mute)" }}>
          All actions resolved today.
        </p>
      )}
    </section>
  );
}

function ActionItemInline({ item }: { item: ActionItem }) {
  const [done, setDone] = useState(!!item.resolved_at);
  const [busy, setBusy] = useState(false);

  async function markDone() {
    setBusy(true);
    const res = await fetch("/api/me/action-resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: item.id }),
    });
    if (res.ok) {
      setDone(true);
      if (item.xpReward > 0) setTimeout(() => window.location.reload(), 300);
    }
    setBusy(false);
  }

  return (
    <li
      className={`flex items-center gap-2 rounded-lg p-2 ${done ? "opacity-50" : ""}`}
      style={{
        background: "var(--bg-sunken)",
        border: "1px solid var(--border)",
      }}
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${severityDot(item.severity)}`} />
      <p
        className={`flex-1 text-[12px] leading-tight truncate ${done ? "line-through" : ""}`}
        style={{ color: done ? "var(--text-mute)" : "var(--text)" }}
        title={item.title}
      >
        {item.title}
      </p>

      {item.xpReward !== 0 && !done && (
        <span
          className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md whitespace-nowrap"
          style={{
            background: item.xpReward > 0 ? "var(--accent-soft)" : "rgba(200, 16, 46, 0.12)",
            color: item.xpReward > 0 ? "var(--accent)" : "var(--error)",
            border: `1px solid ${item.xpReward > 0 ? "rgba(242, 169, 0, 0.45)" : "rgba(200, 16, 46, 0.4)"}`,
          }}
        >
          {item.xpReward > 0 ? "+" : ""}{item.xpReward}
        </span>
      )}

      {!done && item.xpReward > 0 && (
        <button
          onClick={markDone}
          disabled={busy}
          className="text-[10px] px-2 py-0.5 rounded-md border disabled:opacity-50 transition whitespace-nowrap"
          style={{
            background: "var(--input-bg)",
            color: "var(--text)",
            borderColor: "var(--border)",
          }}
        >
          {busy ? "..." : "Done"}
        </button>
      )}
    </li>
  );
}
