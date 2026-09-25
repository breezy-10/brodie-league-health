/**
 * Colour banding for the two discount rates, shared by the Discounts tab and
 * its drill-down so the same number never reads differently in the two places.
 *
 * Both rates use the same three bands — nothing given away, some, too much —
 * but the red line differs because the rates mean different things. A quarter
 * of registrations carrying any code is heavy; a tenth paying nothing at all is
 * heavier, and the free figure is a subset of the discounted one.
 */
export const DISCOUNT_RED_AT_PCT = 25;
export const FREE_RED_AT_PCT = 10;

export const DANGER = "var(--glass-danger-text, rgb(248,113,113))";
export const WARNING = "var(--glass-warning-text, var(--glass-gold))";
export const SUCCESS = "var(--glass-success-text, rgb(74,222,128))";

// Rounded before banding so what the eye reads and what the colour says agree:
// 24.6% prints as 25% and must colour like 25%, not like 24%.
export function tone(pct: number, redAt: number): string {
  const p = Math.round(pct);
  if (p === 0) return SUCCESS;
  return p >= redAt ? DANGER : WARNING;
}
export const freeTone = (pct: number) => tone(pct, FREE_RED_AT_PCT);
export const discountTone = (pct: number) => tone(pct, DISCOUNT_RED_AT_PCT);
