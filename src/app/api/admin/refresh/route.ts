import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { runDailySync, recomputeScores } from "@/lib/scoring/engine";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST() {
  await requireRole(["super_admin"]);
  const report = await runDailySync({ triggeredBy: "manual" });
  const scored = await recomputeScores();
  return NextResponse.json({ ok: true, report, scored });
}
