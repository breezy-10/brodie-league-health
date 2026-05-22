import { NextResponse } from "next/server";

export function requireCron(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return null;
  const auth = req.headers.get("authorization") ?? "";
  if (auth === `Bearer ${secret}`) return null;
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}
