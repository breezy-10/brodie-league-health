/**
 * Achievement → badge PNG mapping. We reuse the 4 training-app badge images
 * (net, bullseye, coin, hands) across our 14 achievements with intent:
 *
 *   net       — onboarding milestones (first day, first 100 XP)
 *   bullseye  — perfect-execution achievements (perfect day, on-time SLAs)
 *   coin      — tier promotions (rookie → pro → elite → HOF)
 *   hands     — collaboration / cleanup (clean board, helping staff)
 *
 * Achievements that haven't been mapped fall back to net.png.
 */
export const BADGE_ICON_BY_SLUG: Record<string, string> = {
  first_century:    "/badges/net.png",
  streak_3:         "/badges/bullseye.png",
  streak_7:         "/badges/bullseye.png",
  streak_30:        "/badges/bullseye.png",
  tier_pro:         "/badges/coin.png",
  tier_elite:       "/badges/coin.png",
  tier_hof:         "/badges/coin.png",
  daily_champ:      "/badges/coin.png",
  weekly_champ:     "/badges/coin.png",
  crm_killer:       "/badges/bullseye.png",
  facility_steward: "/badges/hands.png",
  comeback_kid:     "/badges/net.png",
  clean_board:      "/badges/hands.png",
  perfect_day:      "/badges/bullseye.png",
};

export function iconForSlug(slug: string): string {
  return BADGE_ICON_BY_SLUG[slug] ?? "/badges/net.png";
}
