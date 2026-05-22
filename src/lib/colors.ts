export function scoreColor(pct: number): string {
  if (pct >= 85) return "text-brodie-good";
  if (pct >= 65) return "text-brodie-warn";
  return "text-brodie-bad";
}
export function scoreBg(pct: number): string {
  if (pct >= 85) return "bg-brodie-good/15 border-brodie-good/40";
  if (pct >= 65) return "bg-brodie-warn/15 border-brodie-warn/40";
  return "bg-brodie-bad/15 border-brodie-bad/40";
}
