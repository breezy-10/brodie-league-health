import { NextResponse } from "next/server";

// Fail closed: /api/cron is public in middleware (Vercel Cron sends no
// cookies), so this header check is the only thing standing between the
// internet and a full sync / Slack blast. A missing CRON_SECRET used to let
// every request through.
export function requireCron(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron] CRON_SECRET is not set; refusing cron request");
    return NextResponse.json({ error: "cron not configured" }, { status: 503 });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth === `Bearer ${secret}`) return null;
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}
