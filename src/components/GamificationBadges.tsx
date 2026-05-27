import { TIER_LABEL, type Tier } from "@/lib/scoring/gamification";

/**
 * Glass-pill badges, post-CRM-token-refresh: solid raised surface, hairline
 * border, soft glow on the leading dot. No translucency, no backdrop blur.
 * WCAG-AA contrast on both themes.
 */

const PILL_BASE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 12px",
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  background: "var(--bg-raised)",
  border: "1px solid var(--border)",
  transition: "background 160ms ease, border-color 160ms ease",
};

function dotColor(tier: Tier): string {
  if (tier === "hall_of_fame") return "var(--accent)";
  if (tier === "elite")        return "#af52de";
  if (tier === "pro")          return "#007aff";
  return "#34d399"; // rookie
}

function tierBorder(tier: Tier): string {
  if (tier === "hall_of_fame") return "rgba(242, 169, 0, 0.45)";
  if (tier === "elite")        return "rgba(175, 82, 222, 0.45)";
  if (tier === "pro")          return "rgba(0, 122, 255, 0.45)";
  return "rgba(52, 211, 153, 0.4)";
}

function GlowDot({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      style={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: color,
        boxShadow: `0 0 0 1px rgba(0,0,0,0.35), 0 0 6px ${color}80`,
        display: "inline-block",
      }}
    />
  );
}

export function TierBadge({ tier, avg30d }: { tier: Tier; avg30d?: number | null }) {
  return (
    <span style={{ ...PILL_BASE, borderColor: tierBorder(tier), color: "var(--text)" }}>
      <GlowDot color={dotColor(tier)} />
      <span>{TIER_LABEL[tier]}</span>
      {avg30d != null && (
        <span style={{ color: "var(--text-mute)", fontWeight: 500 }}>
          · {Math.round(avg30d)}% / 30d
        </span>
      )}
    </span>
  );
}

export function StreakBadge({ days }: { days: number }) {
  if (!days) {
    return (
      <span style={{ ...PILL_BASE, color: "var(--text-mute)" }}>
        <span aria-hidden style={{ opacity: 0.4 }}>🔥</span>
        <span>No streak</span>
      </span>
    );
  }
  const intense = days >= 7;
  return (
    <span
      style={{
        ...PILL_BASE,
        color: intense ? "#fb923c" : "var(--text)",
        borderColor: intense ? "rgba(251, 146, 60, 0.5)" : "rgba(251, 146, 60, 0.25)",
        background: "var(--bg-raised)",
      }}
    >
      <span aria-hidden>🔥</span>
      <span>{days}-day streak</span>
    </span>
  );
}

export function ChampionRibbon({ kind }: { kind: "daily" | "weekly" }) {
  return (
    <span
      style={{
        ...PILL_BASE,
        color: "var(--accent)",
        borderColor: "rgba(242, 169, 0, 0.5)",
        background: "var(--accent-soft)",
      }}
    >
      <span aria-hidden>{kind === "daily" ? "🥇" : "🏅"}</span>
      <span>{kind === "daily" ? "Today's champion" : "This week's champion"}</span>
    </span>
  );
}
