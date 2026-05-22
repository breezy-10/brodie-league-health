import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  await requireUser();
  const { id } = (await req.json()) as { id: string };
  const sb = await createClient();
  await sb.from("daily_action_items").update({ resolved_at: new Date().toISOString() }).eq("id", id);
  return NextResponse.json({ ok: true });
}
