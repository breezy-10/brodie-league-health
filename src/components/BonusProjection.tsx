import type { BonusProjection } from "@/lib/compensation";
import { formatCents } from "@/lib/compensation";

export function BonusProjectionCard({ projection }: { projection: BonusProjection | null }) {
  if (!projection) return null;
  const {
    annual_base_cents,
    current_avg_pct,
    unlock_share,
    unlock_label,
    projected_annual_cents,
    projected_quarter_cents,
    pct_to_next_tier,
    next_tier,
  } = projection;

  const sharePct = Math.round(unlock_share * 100);

  return (
    <section
      className="rounded-2xl border p-5 brodie-card"
      style={{
        background: "var(--bg-raised)",
        borderColor: "rgba(242, 169, 0, 0.45)",
      }}
    >
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <p className="uppercase text-[10px] tracking-[0.08em] font-semibold mb-1" style={{ color: "var(--accent)" }}>
            Projected commission · {unlock_label} pace
          </p>
          <p className="text-3xl font-semibold tracking-tight" style={{ color: "var(--text)" }}>
            {formatCents(projected_quarter_cents)}
            <span className="text-base font-normal" style={{ color: "var(--text-mute)" }}> this quarter</span>
          </p>
          <p className="text-xs mt-1" style={{ color: "var(--text-mute)" }}>
            {formatCents(projected_annual_cents)}/yr at current pace · {sharePct}% of {formatCents(annual_base_cents)} base
          </p>
        </div>
        {next_tier && pct_to_next_tier != null && (
          <div
            className="rounded-xl p-3 text-right"
            style={{ background: "var(--bg-sunken)", border: "1px solid var(--border)" }}
          >
            <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: "var(--text-mute)" }}>
              Next tier
            </p>
            <p className="text-sm font-semibold mt-0.5" style={{ color: "var(--text)" }}>
              {next_tier.label}
            </p>
            <p className="text-[11px] mt-0.5" style={{ color: "var(--text-mute)" }}>
              +{Math.round(pct_to_next_tier)} pct points → {formatCents(Math.round(annual_base_cents * next_tier.share / 4))}/qtr
            </p>
          </div>
        )}
      </div>
      <div className="mt-3 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
        <div
          className="h-full"
          style={{
            width: `${Math.min(100, Math.max(0, current_avg_pct))}%`,
            background: "var(--accent)",
            transition: "width 400ms ease",
          }}
        />
      </div>
      <p className="text-[10px] mt-1.5" style={{ color: "var(--text-mute)" }}>
        30-day average: {Math.round(current_avg_pct)}%
      </p>
    </section>
  );
}
