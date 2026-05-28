"use client";

import { useState } from "react";

type Point = { d: string; p: number };

/**
 * 30-day pct trend chart. SVG, no chart library.
 * - Each day = one dot; today is highlighted larger.
 * - Hover any dot for an inline tooltip with date + pct.
 * - Dashed reference line at the 30-day average.
 * - Caption beneath shows the average + the LM's pct delta vs avg.
 *
 * Empty days (no snapshot) are dropped — we don't fake zeros, because
 * "missing data" is not the same as "got a zero".
 */
export function ScoreHistoryChart({ points }: { points: Point[] }) {
  const [hovered, setHovered] = useState<number | null>(null);

  if (!points.length) {
    return (
      <p className="text-sm" style={{ color: "var(--text-mute)" }}>
        No history yet. Once we run a few syncs you'll see your trajectory here.
      </p>
    );
  }

  const W = 600;
  const H = 110;
  const PAD_L = 28;
  const PAD_R = 12;
  const PAD_T = 12;
  const PAD_B = 22;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const avg =
    points.reduce((s, p) => s + p.p, 0) / Math.max(points.length, 1);
  const lastPct = points[points.length - 1]?.p ?? 0;
  const deltaVsAvg = Math.round(lastPct - avg);

  const yMin = 0;
  const yMax = 100;
  const step =
    points.length > 1 ? innerW / (points.length - 1) : 0;
  const xy = (i: number, p: number) => ({
    x: PAD_L + i * step,
    y: PAD_T + (1 - (p - yMin) / (yMax - yMin)) * innerH,
  });

  const path = points
    .map((p, i) => {
      const { x, y } = xy(i, p.p);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const areaPath =
    path +
    ` L${(PAD_L + (points.length - 1) * step).toFixed(1)},${(PAD_T + innerH).toFixed(1)}` +
    ` L${PAD_L.toFixed(1)},${(PAD_T + innerH).toFixed(1)} Z`;

  const avgY = PAD_T + (1 - (avg - yMin) / (yMax - yMin)) * innerH;
  const todayIdx = points.length - 1;

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height="auto"
        preserveAspectRatio="none"
        style={{ display: "block", maxHeight: 160 }}
      >
        {/* y-axis ticks */}
        {[0, 50, 100].map((v) => {
          const y = PAD_T + (1 - v / 100) * innerH;
          return (
            <g key={v}>
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={y}
                y2={y}
                stroke="var(--border)"
                strokeWidth={0.5}
                strokeDasharray={v === 0 ? "0" : "2 4"}
              />
              <text
                x={PAD_L - 6}
                y={y + 3}
                fontSize="9"
                textAnchor="end"
                fill="var(--text-mute)"
              >
                {v}
              </text>
            </g>
          );
        })}

        {/* 30d avg reference */}
        <line
          x1={PAD_L}
          x2={W - PAD_R}
          y1={avgY}
          y2={avgY}
          stroke="var(--text-mute)"
          strokeWidth={1}
          strokeDasharray="3 3"
          opacity={0.5}
        />

        {/* filled area under line */}
        <path d={areaPath} fill="var(--accent)" opacity={0.08} />

        {/* trend line */}
        <path
          d={path}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* point dots */}
        {points.map((p, i) => {
          const { x, y } = xy(i, p.p);
          const isToday = i === todayIdx;
          const isHovered = hovered === i;
          return (
            <g key={i}>
              <circle
                cx={x}
                cy={y}
                r={isToday ? 4 : isHovered ? 3.5 : 2}
                fill="var(--accent)"
                stroke={isToday ? "var(--bg-raised)" : "none"}
                strokeWidth={isToday ? 1.5 : 0}
              />
              {/* invisible big hit target for hover */}
              <circle
                cx={x}
                cy={y}
                r={10}
                fill="transparent"
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                style={{ cursor: "pointer" }}
              />
              {isHovered && (
                <g>
                  <rect
                    x={Math.min(Math.max(x - 38, PAD_L), W - PAD_R - 76)}
                    y={Math.max(y - 30, 2)}
                    width={76}
                    height={22}
                    rx={4}
                    fill="var(--bg-sunken)"
                    stroke="var(--border)"
                  />
                  <text
                    x={Math.min(Math.max(x, PAD_L + 38), W - PAD_R - 38)}
                    y={Math.max(y - 15, 17)}
                    fontSize="10"
                    textAnchor="middle"
                    fill="var(--text)"
                  >
                    {shortDate(p.d)} · {p.p}%
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* x-axis labels (first + last) */}
        {points.length > 0 && (
          <>
            <text
              x={PAD_L}
              y={H - 6}
              fontSize="9"
              fill="var(--text-mute)"
              textAnchor="start"
            >
              {shortDate(points[0].d)}
            </text>
            <text
              x={W - PAD_R}
              y={H - 6}
              fontSize="9"
              fill="var(--text-mute)"
              textAnchor="end"
            >
              Today
            </text>
          </>
        )}
      </svg>

      <div className="mt-2 flex items-center justify-between flex-wrap gap-2 text-[11px]">
        <p style={{ color: "var(--text-mute)" }}>
          {points.length}-day average: <span style={{ color: "var(--text)" }}>{Math.round(avg)}%</span>
        </p>
        {deltaVsAvg !== 0 && (
          <p
            className="font-semibold"
            style={{
              color: deltaVsAvg > 0 ? "var(--ok, #22b24c)" : "var(--error)",
            }}
          >
            {deltaVsAvg > 0 ? "▲" : "▼"} {Math.abs(deltaVsAvg)} pts vs your average
          </p>
        )}
      </div>
    </div>
  );
}

function shortDate(d: string): string {
  // d is yyyy-mm-dd. Render as "May 28".
  const [, m, day] = d.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mi = Math.max(0, Math.min(11, Number(m) - 1));
  return `${months[mi]} ${Number(day)}`;
}
