import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyDmOfDispute } from "@/lib/slack/dispute-notify";
import { logAudit, AUDIT_ACTIONS } from "@/lib/audit";

/**
 * LM files a dispute on one of their own metrics. (Admins can file on
 * anyone's behalf — useful when an LM raises it verbally in a 1:1.)
 *
 * Body: { lmId?: string, snapshotDate: string, metricId: string, reason: string }
 * If lmId is omitted, defaults to the calling user's LM row.
 */
export async function POST(req: Request) {
  const ctx = await requireUser();
  const body = (await req.json()) as {
    lmId?: string;
    snapshotDate: string;
    metricId: string;
    reason: string;
  };

  const reason = (body.reason ?? "").trim();
  if (reason.length < 4) {
    return NextResponse.json(
      { error: "Tell us a bit more about what's wrong (min 4 chars)." },
      { status: 400 }
    );
  }
  if (reason.length > 2000) {
    return NextResponse.json(
      { error: "Keep it under 2000 characters." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const isAdmin =
    ctx.profile?.role === "dm" || ctx.profile?.role === "super_admin";

  // Resolve the target LM. If caller is not admin, force lmId = their own.
  let targetLmId: string | null = body.lmId ?? null;
  if (!isAdmin || !targetLmId) {
    const { data: lm } = await admin
      .from("league_managers")
      .select("id")
      .eq("email", (ctx.user.email ?? "").toLowerCase())
      .maybeSingle();
    targetLmId = (lm as { id: string } | null)?.id ?? null;
  }
  if (!targetLmId) {
    return NextResponse.json(
      { error: "We can't find your LM row — ask an admin to add you to the roster." },
      { status: 400 }
    );
  }

  // Insert. The unique partial index on (lm_id, snapshot_date, metric_id) where
  // status='open' will reject a duplicate open dispute.
  const { data, error } = await admin
    .from("metric_disputes")
    .insert({
      lm_id: targetLmId,
      snapshot_date: body.snapshotDate,
      metric_id: body.metricId,
      reason,
      filed_by: ctx.user.id,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "You already have an open dispute on this metric for this day." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const disputeId = (data as { id: string }).id;

  // Fire-and-forget Slack ping. Never block the LM on it.
  notifyDmOfDispute(disputeId).catch(() => {});

  await logAudit({
    actorId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: AUDIT_ACTIONS.DISPUTE_FILED,
    targetType: "metric_dispute",
    targetId: disputeId,
    payload: {
      lm_id: targetLmId,
      metric_id: body.metricId,
      snapshot_date: body.snapshotDate,
    },
  });

  return NextResponse.json({ ok: true, id: disputeId });
}
