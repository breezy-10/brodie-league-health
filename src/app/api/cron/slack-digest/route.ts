import { NextResponse } from "next/server";
import { sendDailyDigest } from "@/lib/slack/digest";
import { requireCron } from "@/lib/cron-auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const denied = requireCron(req);
  if (denied) return denied;
  const result = await sendDailyDigest();
  return NextResponse.json({ ok: true, ...result });
}
