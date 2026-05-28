import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { rerollLM } from "@/lib/scoring/reroll";
import { logAudit, AUDIT_ACTIONS } from "@/lib/audit";

/**
 * DM (or super_admin) resolves a dispute.
 *
 * Body: {
 *   id: string,
 *   decision: 'approved' | 'rejected',
 *   dmNote?: string,
 *   scoreAdjustment?: number   // positive or negative, in XP units
 * }
 *
 * On approve with scoreAdjustment, we DON'T touch the underlying snapshot —
 * we insert a synthetic adjustment snapshot tagged via raw_payload so the
 * audit trail is clear, then re-roll the LM's daily total.
 */
export async function POST(req: Request) {
  const ctx = await requireRole(["dm", "super_admin"]);
  const body = (await req.json()) as {
    id: string;
    decision: "approved" | "rejected";
    dmNote?: string;
    scoreAdjustment?: number;
  };
  if (!body.id || !["approved", "rejected"].includes(body.decision)) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("metric_disputes")
    .select("id, lm_id, snapshot_date, metric_id, status")
    .eq("id", body.id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const d = existing as {
    id: string;
    lm_id: string;
    snapshot_date: string;
    metric_id: string;
    status: string;
  };
  if (d.status !== "open") {
    return NextResponse.json({ error: "Already resolved." }, { status: 400 });
  }

  const adjustment =
    body.decision === "approved" && Number.isFinite(body.scoreAdjustment)
      ? Number(body.scoreAdjustment)
      : 0;

  await admin
    .from("metric_disputes")
    .update({
      status: body.decision,
      dm_note: (body.dmNote ?? "").trim() || null,
      score_adjustment: adjustment || null,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", body.id);

  // If approved with a non-zero adjustment, write a synthetic snapshot
  // adjustment row and re-roll. We tag the raw_payload with dispute_id so
  // it's traceable and reversible.
  if (adjustment !== 0) {
    const { data: metric } = await admin
      .from("metrics")
      .select("app_id")
      .eq("id", d.metric_id)
      .maybeSingle();
    const appId = (metric as { app_id: string } | null)?.app_id;
    if (appId) {
      // Look for an existing adjustment row for this dispute first (idempotent
      // if the DM hits Approve twice somehow).
      const { data: existingAdj } = await admin
        .from("daily_snapshots")
        .select("id, score")
        .eq("lm_id", d.lm_id)
        .eq("snapshot_date", d.snapshot_date)
        .eq("metric_id", d.metric_id)
        .contains("raw_payload", { dispute_id: d.id })
        .maybeSingle();

      if (existingAdj) {
        await admin
          .from("daily_snapshots")
          .update({ score: adjustment })
          .eq("id", (existingAdj as { id: string }).id);
      } else {
        await admin.from("daily_snapshots").insert({
          lm_id: d.lm_id,
          app_id: appId,
          metric_id: d.metric_id,
          snapshot_date: d.snapshot_date,
          score: adjustment,
          max_score: 0,
          raw_value: 0,
          raw_payload: { source: "dispute_adjustment", dispute_id: d.id },
        });
      }

      await rerollLM(d.lm_id, d.snapshot_date);
    }
  }

  await logAudit({
    actorId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: AUDIT_ACTIONS.DISPUTE_RESOLVED,
    targetType: "metric_dispute",
    targetId: d.id,
    payload: {
      decision: body.decision,
      score_adjustment: adjustment,
      lm_id: d.lm_id,
      metric_id: d.metric_id,
      snapshot_date: d.snapshot_date,
      dm_note_present: !!(body.dmNote ?? "").trim(),
    },
  });

  return NextResponse.json({ ok: true });
}
