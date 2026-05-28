"use client";

import { useState } from "react";
import { scoreColor, severityDot } from "@/lib/colors";
import { APP_DEEP_LINKS } from "@/lib/app-urls";
import { helpForMetric } from "@/lib/metric-help";
import { DisputeButton } from "@/components/DisputeButton";

export type ActionItem = {
  id: string;
  title: string;
  detail: string | null;
  severity: string;
  resolved_at: string | null;
  xpReward: number;
};

export type MetricBreakdown = Record<string, { score: number; max: number }>;

export type DisputeInfo = {
  status: string;
  dm_note: string | null;
  score_adjustment: number | null;
  resolved_at: string | null;
  snapshot_date: string;
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
  metrics,
  metricIdBySlug,
  snapshotDate,
  lmId,
  disputable = true,
  disputesByMetricSlug,
}: {
  appSlug: string;
  appName: string;
  score: number;
  max: number;
  actions: ActionItem[];
  metrics?: MetricBreakdown;
  /** metric slug → metric uuid. Required for the Dispute button to work. */
  metricIdBySlug?: Record<string, string>;
  /** The day this card represents. Required for dispute filing. */
  snapshotDate?: string;
  /** Pass when an admin is viewing-as another LM. */
  lmId?: string;
  /** Hide dispute UI in view-as mode so admins don't accidentally file on
   *  someone else's behalf without thinking about it. */
  disputable?: boolean;
  /** Map of metric slug → most recent dispute filed by this LM (any status,
   *  in the last 14 days). Renders a status pill inline. Closes the trust
   *  loop — the LM sees the DM's decision next time they look. */
  disputesByMetricSlug?: Record<string, DisputeInfo>;
  readOnly?: boolean; // accepted for API compat; ignored
}) {
  const [expanded, setExpanded] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
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

      {/* Score block + Why? button */}
      <div className="flex items-baseline gap-2">
        <span className={`text-2xl font-semibold tracking-tight ${scoreColor(pct)}`}>
          {Math.round(score)}
        </span>
        <span className="text-xs" style={{ color: "var(--text-mute)" }}>
          / {Math.round(max)} pts · {pct}%
        </span>
        {metrics && Object.keys(metrics).length > 0 && (
          <button
            onClick={() => setWhyOpen((v) => !v)}
            className="ml-auto text-[10px] font-semibold uppercase tracking-wider transition"
            style={{ color: whyOpen ? "var(--accent)" : "var(--text-mute)" }}
            aria-label="Show metric breakdown"
          >
            {whyOpen ? "Hide ▴" : "Why? ▾"}
          </button>
        )}
      </div>

      {/* Per-metric breakdown — collapsible */}
      {whyOpen && metrics && (
        <ul
          className="mt-3 space-y-1.5 rounded-xl p-3"
          style={{ background: "var(--bg-sunken)", border: "1px solid var(--border)" }}
        >
          {Object.entries(metrics).map(([slug, m]) => {
            const help = helpForMetric(slug);
            const s = Number(m.score);
            const mx = Number(m.max);
            const metricId = metricIdBySlug?.[slug];
            const canDispute = disputable && !!metricId && !!snapshotDate;
            return (
              <li key={slug} className="text-[11px]">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold" style={{ color: "var(--text)" }}>
                    {help.label}
                  </span>
                  <span
                    className="font-mono whitespace-nowrap"
                    style={{
                      color: s > 0 ? "var(--ok)" : s < 0 ? "var(--error)" : "var(--text-mute)",
                    }}
                  >
                    {s > 0 ? "+" : ""}{Math.round(s * 10) / 10}{mx > 0 ? ` / ${Math.round(mx)}` : ""}
                  </span>
                </div>
                <p className="mt-0.5 leading-snug" style={{ color: "var(--text-mute)" }}>
                  {help.how}
                </p>
                {canDispute && (
                  <div className="mt-1 flex items-center gap-2 flex-wrap">
                    <DisputeButton
                      metricId={metricId!}
                      snapshotDate={snapshotDate!}
                      metricLabel={help.label}
                      appName={appName}
                      lmId={lmId}
                    />
                    {disputesByMetricSlug?.[slug] && (
                      <DisputeStatusChip info={disputesByMetricSlug[slug]} />
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

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

/**
 * Inline pill that surfaces the DM's decision on the most recent dispute
 * the LM filed against this metric. Click to expand the DM's note.
 * Hidden if there's no dispute in the last 14 days.
 */
function DisputeStatusChip({ info }: { info: DisputeInfo }) {
  const [open, setOpen] = useState(false);
  const label =
    info.status === "approved"
      ? "Dispute approved"
      : info.status === "rejected"
      ? "Dispute rejected"
      : info.status === "withdrawn"
      ? "Withdrawn"
      : "Dispute pending";
  const color =
    info.status === "approved"
      ? "var(--ok, #22b24c)"
      : info.status === "rejected"
      ? "var(--error)"
      : "var(--text-mute)";
  const adj = info.score_adjustment;
  const hasDetail = !!info.dm_note || (adj !== null && adj !== 0);

  return (
    <span className="inline-flex flex-col">
      <button
        onClick={() => hasDetail && setOpen((v) => !v)}
        disabled={!hasDetail}
        className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
        style={{
          background: "var(--bg-sunken)",
          color,
          border: `1px solid ${color}`,
          cursor: hasDetail ? "pointer" : "default",
        }}
      >
        {label}
        {adj !== null && adj !== 0 && (
          <span className="ml-1 font-mono">
            {adj > 0 ? "+" : ""}{adj} XP
          </span>
        )}
        {hasDetail && (
          <span className="ml-1" aria-hidden>
            {open ? "▴" : "▾"}
          </span>
        )}
      </button>
      {open && info.dm_note && (
        <p
          className="mt-1 text-[11px] leading-relaxed rounded p-2"
          style={{
            background: "var(--bg-sunken)",
            border: "1px solid var(--border)",
            color: "var(--text-secondary)",
            maxWidth: 260,
          }}
        >
          {info.dm_note}
        </p>
      )}
    </span>
  );
}
