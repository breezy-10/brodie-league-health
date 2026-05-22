import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function PUT(req: Request) {
  const ctx = await requireUser();
  const { opt_in } = (await req.json()) as { opt_in: boolean };
  const sb = await createClient();
  await sb.from("profiles").update({ opt_in_leaderboard: !!opt_in, updated_at: new Date().toISOString() }).eq("id", ctx.user.id);
  return NextResponse.json({ ok: true });
}
