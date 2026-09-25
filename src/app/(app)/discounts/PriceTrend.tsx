import type { DiscountRow } from "./DiscountsView";

// Season trend: what a registration is advertised at against its total price
// after discount and fees, with the gap between them shaded — that gap is the
// discount.
// Plain SVG, no chart library, same as ScoreHistoryChart.
//
// Rows arrive newest-first from the feed; they are reversed here so the season
// axis reads left to right in time order.
export default function PriceTrend({ rows, currency }: { rows: DiscountRow[]; currency: string }) {
  const pts = [...rows].reverse();
  if (pts.length < 2) return null;

  const W = 760, H = 240;
  const ML = 52, MR = 58, MT = 18, MB = 34;
  const innerW = W - ML - MR, innerH = H - MT - MB;

  const values = pts.flatMap((p) => [p.list_price, p.total_paid]);
  const lo = Math.min(...values), hi = Math.max(...values);
  const pad = (hi - lo) * 0.22 || 10;
  const yLo = lo - pad, yHi = hi + pad;

  const X = (i: number) => ML + (innerW * i) / (pts.length - 1);
  const Y = (v: number) => MT + innerH * (1 - (v - yLo) / (yHi - yLo));

  const line = (k: "list_price" | "total_paid") =>
    pts.map((p, i) => `${X(i).toFixed(1)},${Y(p[k]).toFixed(1)}`).join(" ");
  // The shaded gap: list price across, then total price back again.
  const band = [
    ...pts.map((p, i) => `${X(i).toFixed(1)},${Y(p.list_price).toFixed(1)}`),
    ...[...pts].reverse().map((p, i) => `${X(pts.length - 1 - i).toFixed(1)},${Y(p.total_paid).toFixed(1)}`),
  ].join(" ");

  // Gridlines on a round step that lands inside the range.
  const span = yHi - yLo;
  const step = span > 120 ? 40 : span > 60 ? 20 : 10;
  const ticks: number[] = [];
  for (let t = Math.ceil(yLo / step) * step; t < yHi; t += step) ticks.push(t);

  const last = pts[pts.length - 1];
  const short = (s: string) => s.replace(/^(\w{3})\w*\s/, "$1 ");
  const money = (n: number) => `$${Math.round(n)}`;

  return (
    <div className="rounded-2xl border border-glass-border bg-glass-surface px-3 py-3">
      <div className="flex items-center gap-4 px-2 pb-1 text-[11px]" style={{ color: "var(--glass-text-tertiary)" }}>
        <span className="flex items-center gap-1.5">
          <i style={{ width: 14, height: 3, borderRadius: 2, background: "#5B8AC4", display: "inline-block" }} />
          List price
        </span>
        <span className="flex items-center gap-1.5">
          <i style={{ width: 14, height: 3, borderRadius: 2, background: "var(--glass-gold)", display: "inline-block" }} />
          Total price
        </span>
        <span className="flex items-center gap-1.5">
          <i style={{ width: 10, height: 10, borderRadius: 2, background: "var(--glass-gold)", opacity: 0.16, display: "inline-block" }} />
          Discount
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block" role="img"
        aria-label={`Average list price and total price per registration by season, ${currency}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={ML} y1={Y(t)} x2={W - MR} y2={Y(t)} stroke="var(--glass-border)" strokeWidth={1} />
            <text x={ML - 9} y={Y(t) + 4} textAnchor="end" fontSize={10.5}
              fill="var(--glass-text-tertiary)" className="tabular">{money(t)}</text>
          </g>
        ))}
        <polygon points={band} fill="var(--glass-gold)" opacity={0.16} />
        <polyline points={line("list_price")} fill="none" stroke="#5B8AC4" strokeWidth={2}
          strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={line("total_paid")} fill="none" stroke="var(--glass-gold)" strokeWidth={2}
          strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => (
          <g key={p.season}>
            <circle cx={X(i)} cy={Y(p.list_price)} r={3.5} fill="#5B8AC4">
              <title>{p.season} — list {money(p.list_price)}, {p.regs.toLocaleString()} registrations</title>
            </circle>
            <circle cx={X(i)} cy={Y(p.total_paid)} r={3.5} fill="var(--glass-gold)">
              <title>{p.season} — total price {money(p.total_paid)}, discount {money(p.discount)}</title>
            </circle>
            <text x={X(i)} y={H - MB + 20} textAnchor="middle" fontSize={10}
              fill="var(--glass-text-tertiary)">{short(p.season)}</text>
          </g>
        ))}
        <text x={W - MR + 8} y={Y(last.list_price) + 4} fontSize={11} fill="#5B8AC4" className="tabular">
          {money(last.list_price)}
        </text>
        <text x={W - MR + 8} y={Y(last.total_paid) + 4} fontSize={11} fill="var(--glass-gold)" className="tabular">
          {money(last.total_paid)}
        </text>
      </svg>
    </div>
  );
}
