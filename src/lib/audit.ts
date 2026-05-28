import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Append a row to audit_log. Never throws — audit failures should never
 * break the user's primary action. Always called via the admin client so
 * we don't trip RLS or require a logged-in user (some events come from
 * cron / system code paths).
 */
export async function logAudit(entry: {
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  payload?: Record<string, unknown>;
}) {
  try {
    const admin = createAdminClient();
    await admin.from("audit_log").insert({
      actor_id: entry.actorId ?? null,
      actor_email: entry.actorEmail ?? null,
      action: entry.action,
      target_type: entry.targetType ?? null,
      target_id: entry.targetId ?? null,
      payload: entry.payload ?? {},
    });
  } catch {
    // Swallow — never let audit problems propagate.
  }
}

/** Common action slugs. Use these constants so the queryable surface stays
 *  stable as we add more code paths. */
export const AUDIT_ACTIONS = {
  DISPUTE_FILED: "dispute_filed",
  DISPUTE_RESOLVED: "dispute_resolved",
  WEIGHT_CHANGED: "weight_changed",
  VIEW_AS_OPENED: "view_as_opened",
  WELCOME_SENT: "welcome_sent",
  GOAL_SET: "goal_set",
} as const;
