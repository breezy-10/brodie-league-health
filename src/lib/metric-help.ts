/**
 * Plain-English "how to improve" hints per metric slug. Surfaced in the
 * AppCard expander so LMs understand *why* their score is what it is and
 * what specific behavior moves it.
 */
export const METRIC_HELP: Record<string, { label: string; how: string }> = {
  // CRM
  crm_touch: {
    label: "Daily touches",
    how: "1 XP per outbound activity or completed cadence_event. Capped at 3 per lead/channel/day so spamming doesn't count. Hit 50/day for the +10 bonus.",
  },
  crm_50_bonus: {
    label: "50-touch bonus",
    how: "One-time +10 the day you hit 50 real touches.",
  },
  crm_ig_no_outcome: {
    label: "IG DM follow-through",
    how: "Outbound IG DMs older than 24h with no logged outcome cost 0.5 XP each. Log the outcome in CRM to stop the bleed.",
  },

  // Facilities
  invoice_followup: {
    label: "Invoice follow-up",
    how: "Each invoice with scheduled_pay_date within 4 business days. Pay or escalate to your DM before it goes overdue.",
  },
  invoice_overdue: {
    label: "Overdue invoices",
    how: "-3 XP/day per invoice past scheduled_pay_date. Resolves when status flips to paid.",
  },
  contract_gap: {
    label: "Contract gap risk",
    how: "-3 XP/day per facility with an active contract ending in <30 days and no follow-on. Sign or extend the contract.",
  },

  // Ref payroll
  ref_payroll_on_time: {
    label: "Payroll submitted",
    how: "+15 XP if done by Sunday 11pm ET. +5 XP if done by Monday noon ET.",
  },
  ref_payroll_late_hit: {
    label: "Payroll late",
    how: "-5 by Monday 6pm ET, -10 by midnight, -15 LOCKED if not done by Tuesday. No further deductions after that — the period closes.",
  },
  ref_payroll_drag: {
    label: "(retired)",
    how: "Replaced by the bounded late_hit penalty. Always 0 now.",
  },

  // Training
  training_staff_completion: {
    label: "Staff training",
    how: "+5 XP for every staff member at your location who completed an assigned training module today.",
  },
  training_ghost_staff: {
    label: "Ghost staff",
    how: "-2 XP/day per active staff member with zero training completions in 30+ days. Nudge them or escalate to HR.",
  },

  // Stats health
  stats_dispute_on_time: {
    label: "Dispute triage on time",
    how: "+10 XP per dispute_submission you triage within 48 business hours of receipt.",
  },
  stats_dispute_overdue: {
    label: "Dispute past SLA",
    how: "-2 XP/day per dispute where triaged_at is null and received_at was >48 BH ago.",
  },

  // Content health
  content_ratio_hit: {
    label: "Clips per AHS hour",
    how: "+10 XP per content night that hit 20 clips per AHS hour.",
  },
  content_ratio_miss: {
    label: "Missed clip target",
    how: "-3 XP per night where the DM logged a clip count below 20/AHS hour. If the DM hasn't counted yet, no penalty hits you.",
  },
  content_post_12h_bonus: {
    label: "12h post bonus",
    how: "+3 XP per night where iphone_clips_posted_at was within 12h of the night.",
  },
  content_never_posted: {
    label: "(retired)",
    how: "Clip counting moved to DMs in June 2026. This metric no longer affects your score.",
  },

  // Ramp credit (virtual metric — only for LMs in first 30 days)
  ramp_credit: {
    label: "Ramp credit",
    how: "+5 XP/day for the first 30 days after your hire date, plus a softer per-app penalty floor. Designed so Day 1 isn't punishing — full scoring kicks in at day 30.",
  },

  // Checklist
  checklist_progress: {
    label: "Checklist progress",
    how: "+5 XP per assigned season_task that flipped to in_progress or done today.",
  },
  checklist_overdue: {
    label: "Overdue checklist tasks",
    how: "-1 XP/day per assigned task past due_date with status='not_started'.",
  },

  // Player feedback (NPS via brodie-feedback)
  feedback_promoter: {
    label: "Promoters (NPS 9-10)",
    how: "+5 XP per response in the last 14 days where the player rated you 9 or 10. Run more memorable games, fix small annoyances early.",
  },
  feedback_detractor: {
    label: "Detractors (NPS < 7)",
    how: "-10 XP per response in the last 14 days rated below 7. Each one creates a follow-up to-do — reach out to the player, address the issue, and the next sync drops it off the window after 14 days.",
  },
};

export function helpForMetric(slug: string): { label: string; how: string } {
  return METRIC_HELP[slug] ?? { label: slug, how: "Sub-metric of this app." };
}
