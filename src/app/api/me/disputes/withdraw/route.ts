import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * LM withdraws their own open dispute (changed their mind, or fixed
 * the underlying data themselves).
 */
export async function POST(req: Request) {
  const ctx = await requireUser();
  const { id } = (await req.json()) as { id: string };
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("metric_disputes")
    .select("id, lm_id, status, filed_by")
    .eq("id", id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const row = existing as { id: string; lm_id: string; status: string; filed_by: string | null };
  if (row.status !== "open") {
    return NextResponse.json({ error: "Already resolved." }, { status: 400 });
  }

  // Confirm caller is the filer (or admin). Filer match handles both
  // self-filed and admin-filed-for-me cases.
  const isAdmin = ctx.profile?.role === "super_admin";
  if (!isAdmin && row.filed_by !== ctx.user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await admin
    .from("metric_disputes")
    .update({
      status: "withdrawn",
      resolved_at: new Date().toISOString(),
      resolved_by: ctx.user.id,
    })
    .eq("id", id);

  return NextResponse.json({ ok: true });
}
