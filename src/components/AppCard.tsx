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
 * Dense per-app tile. Each action row has its own "Lock in →" pill that
 * deep-links to the source app — clicking Done in league-health was a lie
 * (the source app is the source of truth). Once the LM resolves the thing
 * in the source app, the next sync detects it and the row goes away.
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
  readOnly?: boolean; // accepted for API compat; ignored
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
      {/* Top row: app name only — Lock-in moves to each action row */}
      <p
        className="uppercase text-[10px] tracking-[0.08em] font-semibold leading-tight mb-2"
        style={{ color: "var(--text-mute)" }}
      >
        {appName}
      </p>

      {/* Score block */}
      <div className="flex items-baseline gap-2">
        <span className={`text-2xl font-semibold tracking-tight ${scoreColor(pct)}`}>
          {Math.round(score)}
        </span>
        <span className="text-xs" style={{ color: "var(--text-mute)" }}>
          / {Math.round(max)} pts · {pct}%
        </span>
      </div>

      {/* Action items — each has its own Lock-in */}
      {openActions.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {visibleActions.map((a) => (
            <ActionItemInline key={a.id} item={a} appLink={deepLink?.url ?? null} />
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

      {/* Empty state — no actions today */}
      {openActions.length === 0 && (
        <div className="mt-3 flex items-center justify-between gap-2">
          <p className="text-[11px] italic" style={{ color: "var(--text-mute)" }}>
            {actions.length > 0 ? "All actions cleared today." : "Nothing on your plate here."}
          </p>
          {deepLink && <LockInPill href={deepLink.url} />}
        </div>
      )}
    </section>
  );
}

function ActionItemInline({ item, appLink }: { item: ActionItem; appLink: string | null }) {
  return (
    <li
      className="flex items-center gap-2 rounded-lg p-2"
      style={{
        background: "var(--bg-sunken)",
        border: "1px solid var(--border)",
      }}
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${severityDot(item.severity)}`} />
      <p
        className="flex-1 text-[12px] leading-tight truncate"
        style={{ color: "var(--text)" }}
        title={item.detail ?? item.title}
      >
        {item.title}
      </p>

      {item.xpReward !== 0 && (
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

      {appLink && <LockInPill href={appLink} compact />}
    </li>
  );
}

function LockInPill({ href, compact = false }: { href: string; compact?: boolean }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 rounded-full transition whitespace-nowrap"
      style={{
        background: "var(--accent-soft)",
        color: "var(--accent)",
        border: "1px solid rgba(242, 169, 0, 0.5)",
        fontWeight: 700,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        padding: compact ? "2px 8px" : "4px 10px",
        fontSize: compact ? 9 : 10,
      }}
    >
      <span>Lock in</span>
      <span aria-hidden>→</span>
    </a>
  );
}
