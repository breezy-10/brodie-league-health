import { NextResponse } from "next/server";
import { sendDailyDigest } from "@/lib/slack/digest";
import { welcomeNewLMs } from "@/lib/slack/welcome-new-lms";
import { requireCron } from "@/lib/cron-auth";

export const runtime = "nodejs";

/**
 * Daily 12:00 UTC (8am ET). Two things land here, not on sync-all (5am ET):
 *
 *   1. Welcome any new LMs in the roster — moved here so the welcome DM
 *      hits Slack at phone-checking time, not at dawn when it'd be buried.
 *   2. Send each LM their daily digest.
 *
 * Order matters: welcome runs first so a brand-new LM gets the welcome
 * (with sign-in instructions) BEFORE they get a digest mentioning a score
 * they haven't seen yet.
 */
export async function GET(req: Request) {
  const denied = requireCron(req);
  if (denied) return denied;
  const welcomed = await welcomeNewLMs();
  const result = await sendDailyDigest();
  return NextResponse.json({ ok: true, welcomed, ...result });
}
