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
 * Per-app card on My Day. Shows the LM's score for that app + their open
 * action items inline + a deep-link to the source app to "Lock in".
 *
 * Replaces the old "By app" tile grid + standalone "Today's focus" list —
 * actions now live on the card they relate to.
 */
export function AppCard({
  appSlug,
  appName,
  score,
  max,
  actions,
  readOnly = false,
}: {
  appSlug: string;
  appName: string;
  score: number;
  max: number;
  actions: ActionItem[];
  readOnly?: boolean;
}) {
  const pct = max > 0 ? Math.round((score / max) * 100) : 0;
  const deepLink = APP_DEEP_LINKS[appSlug];
  const openActions = actions.filter((a) => !a.resolved_at);

  return (
    <section
      className="rounded-2xl border p-5 space-y-4 brodie-card"
      style={{
        background: "var(--bg-raised)",
        borderColor: "var(--border)",
      }}
    >
      {/* Header: app name + score + pct */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-glass-text-tertiary text-[10px] uppercase tracking-[0.08em] font-semibold">
            {appName}
          </p>
          <div className="flex items-baseline gap-2 mt-1">
            <span className={`text-3xl font-semibold tracking-tight ${scoreColor(pct)}`}>
              {Math.round(score)}
            </span>
            <span className="text-glass-text-tertiary text-sm">
              / {Math.round(max)} pts
            </span>
            <span className={`text-xs font-semibold ${scoreColor(pct)}`}>
              · {pct}%
            </span>
          </div>
        </div>
        {deepLink && (
          <a
            href={deepLink.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full transition"
            style={{
              background: "var(--accent-soft)",
              color: "var(--accent)",
              border: "1px solid rgba(242, 169, 0, 0.5)",
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            <span>Lock in</span>
            <span aria-hidden>→</span>
          </a>
        )}
      </div>

      {/* Action items inline */}
      {openActions.length > 0 && (
        <ul className="space-y-2 pt-1">
          {openActions.map((a) => (
            <ActionItemInline key={a.id} item={a} readOnly={readOnly} />
          ))}
        </ul>
      )}
      {openActions.length === 0 && actions.length > 0 && (
        <p className="text-xs text-glass-text-tertiary italic">
          All actions resolved for today. 💪
        </p>
      )}
    </section>
  );
}

function ActionItemInline({ item, readOnly }: { item: ActionItem; readOnly: boolean }) {
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
      className={`flex items-start gap-3 rounded-xl p-3 ${done ? "opacity-50" : ""}`}
      style={{
        background: "var(--bg-sunken)",
        border: "1px solid var(--border)",
      }}
    >
      <span className={`mt-1.5 inline-block w-2 h-2 rounded-full ${severityDot(item.severity)}`} />
      <div className="flex-1 min-w-0">
        <p className={`text-sm ${done ? "line-through text-glass-text-secondary" : ""}`}>
          {item.title}
        </p>
        {item.detail && (
          <p className="text-xs text-glass-text-secondary mt-1">{item.detail}</p>
        )}
      </div>

      {item.xpReward > 0 && !done && (
        <span
          className="self-center text-[11px] font-semibold px-2 py-1 rounded-md"
          style={{
            background: "var(--accent-soft)",
            color: "var(--accent)",
            border: "1px solid rgba(242, 169, 0, 0.45)",
          }}
        >
          +{item.xpReward} XP
        </span>
      )}

      {!done && !readOnly && (
        <button
          onClick={markDone}
          disabled={busy}
          className="text-xs px-2.5 py-1 rounded-md border border-glass-border hover:bg-glass-surface-hover disabled:opacity-50 transition"
          style={{ background: "var(--input-bg)" }}
        >
          {busy ? "..." : "Done"}
        </button>
      )}
      {readOnly && !done && (
        <span className="text-[10px] uppercase tracking-wider text-glass-text-tertiary px-2 py-1 font-semibold">
          read-only
        </span>
      )}
    </li>
  );
}
