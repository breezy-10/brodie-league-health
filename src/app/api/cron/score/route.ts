import { NextResponse } from "next/server";
import { recomputeScores } from "@/lib/scoring/engine";
import { requireCron } from "@/lib/cron-auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const denied = requireCron(req);
  if (denied) return denied;
  const result = await recomputeScores();
  return NextResponse.json({ ok: true, ...result });
}
