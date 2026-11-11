// A figure with a row of chips under it: the Ambassador teams, Drop-ins,
// Events and Check-ins cards on the dashboard. Yellow for full rosters, red for
// what needs work (thin rosters, a location still without an ambassador team),
// green for a location that has it covered (everyone who played checked in),
// neutral for a plain count.
export const CHIP_STYLE = {
  yellow: { color: "var(--amber-ink)", borderColor: "transparent", background: "var(--amber-tint)" },
  red: { color: "var(--red)", borderColor: "transparent", background: "var(--red-tint)" },
  green: { color: "var(--green)", borderColor: "transparent", background: "var(--green-tint)" },
  // Informational, not a judgement: "4.19 per team", "Burlington 20".
  neutral: { color: "var(--glass-gold)", borderColor: "transparent", background: "var(--glass-gold-light, var(--fill-3))" },
};
// href makes the chip a link, opened in a new tab (another app's page). wrap
// lets a long chip run onto a second line instead of past the card's edge.
export type Chip = { text: string; tone: keyof typeof CHIP_STYLE; href?: string; wrap?: boolean };

export function ChipTile({ label, value, sub, chips, stackChips, accent, footer }: {
  label: string; value: string; sub?: string; chips?: Chip[]; stackChips?: boolean; accent?: string; footer?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-glass-surface px-4 py-3.5 min-w-0 shadow-card">
      <div className="text-xs font-bold text-glass-text-tertiary truncate">{label}</div>
      <div className="mt-1.5 text-2xl font-bold tabular leading-tight" style={{ color: accent ?? "var(--glass-text)" }}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-glass-text-tertiary mt-1 leading-snug">{sub}</div>}
      {chips && chips.length > 0 && (
        <div className={`mt-2 flex gap-1.5 ${stackChips ? "flex-col items-start" : "flex-wrap"}`}>
          {chips.map((c) => c.href ? (
            <a key={c.text} href={c.href} target="_blank" rel="noopener noreferrer"
              className={`text-[11px] font-semibold px-2 py-0.5 max-w-full hover:underline hover:brightness-110 transition ${c.wrap ? "rounded-lg" : "rounded-full sm:whitespace-nowrap"}`}
              style={CHIP_STYLE[c.tone]}>
              {c.text}
            </a>
          ) : (
            <span key={c.text}
              className={`text-[11px] font-semibold px-2 py-0.5 max-w-full ${c.wrap ? "rounded-lg" : "rounded-full sm:whitespace-nowrap"}`}
              style={CHIP_STYLE[c.tone]}>
              {c.text}
            </span>
          ))}
        </div>
      )}
      {footer}
    </div>
  );
}
