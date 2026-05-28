import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { runDailySync, recomputeScores } from "@/lib/scoring/engine";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * LM-facing refresh endpoint. Same logic as /api/admin/refresh but available
 * to any authenticated user. Idempotent — multiple calls per day just
 * re-write today's snapshots.
 */
export async function POST() {
  await requireUser();
  const report = await runDailySync({ triggeredBy: "manual" });
  const scored = await recomputeScores();
  return NextResponse.json({ ok: true, report, scored });
}
