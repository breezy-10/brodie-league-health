import { TIER_LABEL, type Tier } from "@/lib/scoring/gamification";

/**
 * Tier, streak and champion pills, as the kit's Pill: a grey fill, sentence
 * case, no border. A tier is a category, so its dot takes a kit tag colour.
 */

const CHIP_BG = "var(--fill-chip)";
const CHIP_TEXT = "var(--ink)";
const CHIP_TEXT_MUTE = "var(--text-muted)";

const PILL_BASE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  padding: "5px 11px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 600,
  background: CHIP_BG,
  color: CHIP_TEXT,
};

function dotColor(tier: Tier): string {
  if (tier === "hall_of_fame") return "var(--tag-orange)";
  if (tier === "elite")        return "var(--tag-purple)";
  if (tier === "pro")          return "var(--tag-blue)";
  return "var(--tag-green)"; // rookie
}

function Dot({ color }: { color: string }) {
  return <span aria-hidden style={{ width: 7, height: 7, borderRadius: "50%", background: color, display: "inline-block" }} />;
}

export function TierBadge({ tier, avg30d }: { tier: Tier; avg30d?: number | null }) {
  return (
    <span style={PILL_BASE}>
      <Dot color={dotColor(tier)} />
      <span>{TIER_LABEL[tier]}</span>
      {avg30d != null && (
        <span style={{ color: CHIP_TEXT_MUTE, fontWeight: 500 }}>
          · {Math.round(avg30d)}% / 30d
        </span>
      )}
    </span>
  );
}

export function StreakBadge({ days }: { days: number }) {
  if (!days) {
    return (
      <span style={{ ...PILL_BASE, color: CHIP_TEXT_MUTE }}>
        <span>No streak</span>
      </span>
    );
  }
  const intense = days >= 7;
  return (
    <span
      style={{
        ...PILL_BASE,
        ...(intense ? { background: "var(--amber-tint)", color: "var(--amber-ink)" } : {}),
      }}
    >
      <span>{days}-day streak</span>
    </span>
  );
}

export function ChampionRibbon({ kind }: { kind: "daily" | "weekly" }) {
  return (
    <span
      style={{ ...PILL_BASE, background: "var(--ink)", color: "var(--on-ink)" }}
    >
      <span>{kind === "daily" ? "Today's champion" : "This week's champion"}</span>
    </span>
  );
}
