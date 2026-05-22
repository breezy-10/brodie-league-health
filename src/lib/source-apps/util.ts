export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function daysAgo(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() - n);
  return x;
}
export function daysAhead(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}
export function pctScore(numerator: number, denominator: number, max = 100): number {
  if (!denominator) return max;
  return Math.max(0, Math.min(max, Math.round((numerator / denominator) * max)));
}
export function invPctScore(badCount: number, totalCount: number, max = 100): number {
  if (!totalCount) return max;
  return Math.max(0, Math.min(max, Math.round((1 - badCount / totalCount) * max)));
}
