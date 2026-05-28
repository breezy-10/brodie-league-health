import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit, AUDIT_ACTIONS } from "@/lib/audit";

/**
 * Set (or clear) the calling user's personal_goal_pct. Pass `null` to clear.
 */
export async function POST(req: Request) {
  const ctx = await requireUser();
  const { goal } = (await req.json()) as { goal: number | null };

  let next: number | null = null;
  if (goal !== null && goal !== undefined) {
    const n = Math.round(Number(goal));
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      return NextResponse.json({ error: "Goal must be between 0 and 100." }, { status: 400 });
    }
    next = n;
  }

  const admin = createAdminClient();
  await admin
    .from("profiles")
    .update({ personal_goal_pct: next })
    .eq("id", ctx.user.id);

  await logAudit({
    actorId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: AUDIT_ACTIONS.GOAL_SET,
    targetType: "profile",
    targetId: ctx.user.id,
    payload: { goal_pct: next },
  });

  return NextResponse.json({ ok: true, goal: next });
}
