/**
 * Per-app deep links for the "Lock in →" CTA on each action item.
 *
 * Verified live against `vercel project ls --scope brodie-league` 2026-05-28.
 * If a URL is wrong, fix it here.
 */
export type AppDeepLink = {
  url: string;
  label: string;
};

export const APP_DEEP_LINKS: Record<string, AppDeepLink> = {
  crm: {
    url: "https://brodie-crm-pro.vercel.app",
    label: "Open CRM →",
  },
  facilities: {
    url: "https://brodie-facilities.vercel.app",
    label: "Open Facilities →",
  },
  ref_payroll: {
    url: "https://brodie-ref-payroll.vercel.app",
    label: "Open Ref Payroll →",
  },
  training: {
    url: "https://brodie-training.vercel.app",
    label: "Open Training →",
  },
  stats_health: {
    url: "https://brodie-stats-health.vercel.app",
    label: "Open Stats Health →",
  },
  content_health: {
    url: "https://brodie-content-health.vercel.app",
    label: "Open Content Health →",
  },
  checklist: {
    url: "https://brodie-season-success-checklist-brodie-league.vercel.app",
    label: "Open Checklist →",
  },
  ops_schedule: {
    url: "https://brodie-ops-schedule.vercel.app",
    label: "Open Schedule →",
  },
};
