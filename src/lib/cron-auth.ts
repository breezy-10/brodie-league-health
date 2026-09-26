import { NextResponse } from "next/server";

// /api/cron is public in middleware (Vercel Cron sends no cookies), so this
// header check is the only thing standing between the internet and a full
// sync / Slack blast.
//
// TODO(security): fail closed once CRON_SECRET is confirmed set in the live
// Vercel project (it lives in a scope we can't inspect yet). Until then a
// missing secret keeps the old open behaviour so the crons don't silently stop.
export function requireCron(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn("[cron] CRON_SECRET is not set; cron endpoints are open");
    return null;
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth === `Bearer ${secret}`) return null;
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}
