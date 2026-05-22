import { NextResponse } from "next/server";
import { runDailySync } from "@/lib/scoring/engine";
import { requireCron } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: Request) {
  const denied = requireCron(req);
  if (denied) return denied;
  const report = await runDailySync({ triggeredBy: "cron" });
  return NextResponse.json({ ok: true, report });
}
