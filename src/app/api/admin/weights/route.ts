import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit, AUDIT_ACTIONS } from "@/lib/audit";

export const runtime = "nodejs";

type Payload = {
  apps?: Array<{ id: string; weight: number }>;
  metrics?: Array<{ id: string; weight_within_app: number }>;
  note?: string;
};

export async function PUT(req: Request) {
  const ctx = await requireRole(["dm", "super_admin"]);
  const body = (await req.json()) as Payload;
  const sb = createAdminClient();
  const changedBy = ctx.profile?.id ?? null;

  if (body.apps?.length) {
    const { data: current } = await sb.from("apps").select("id, weight").in("id", body.apps.map((a) => a.id));
    const oldMap = new Map((current ?? []).map((a: { id: string; weight: number }) => [a.id, a.weight]));
    for (const a of body.apps) {
      const oldW = oldMap.get(a.id) ?? null;
      await sb.from("apps").update({ weight: a.weight, updated_at: new Date().toISOString() }).eq("id", a.id);
      await sb.from("weight_history").insert({
        changed_by: changedBy,
        scope: "app",
        target_id: a.id,
        old_weight: oldW,
        new_weight: a.weight,
        note: body.note ?? null,
      });
      await logAudit({
        actorId: ctx.user.id,
        actorEmail: ctx.user.email ?? null,
        action: AUDIT_ACTIONS.WEIGHT_CHANGED,
        targetType: "app",
        targetId: a.id,
        payload: { old_weight: oldW, new_weight: a.weight, note: body.note ?? null },
      });
    }
  }
  if (body.metrics?.length) {
    const { data: current } = await sb.from("metrics").select("id, weight_within_app").in("id", body.metrics.map((m) => m.id));
    const oldMap = new Map((current ?? []).map((m: { id: string; weight_within_app: number }) => [m.id, m.weight_within_app]));
    for (const m of body.metrics) {
      const oldW = oldMap.get(m.id) ?? null;
      await sb.from("metrics").update({ weight_within_app: m.weight_within_app, updated_at: new Date().toISOString() }).eq("id", m.id);
      await sb.from("weight_history").insert({
        changed_by: changedBy,
        scope: "metric",
        target_id: m.id,
        old_weight: oldW,
        new_weight: m.weight_within_app,
        note: body.note ?? null,
      });
      await logAudit({
        actorId: ctx.user.id,
        actorEmail: ctx.user.email ?? null,
        action: AUDIT_ACTIONS.WEIGHT_CHANGED,
        targetType: "metric",
        targetId: m.id,
        payload: { old_weight: oldW, new_weight: m.weight_within_app, note: body.note ?? null },
      });
    }
  }
  return NextResponse.json({ ok: true });
}
