import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyAccessRequested } from "@/lib/access-request";

// Raised in this app, notified by this app. The Ops Hub is not involved.
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (!user.email.toLowerCase().endsWith("@brodierec.com")) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const fullName =
    (user.user_metadata?.full_name as string | undefined) ||
    (user.user_metadata?.name as string | undefined) ||
    null;

  // Record the request before announcing it. Slack is how it gets noticed, not
  // where it lives: while the DM was the only record, a Slack failure lost the
  // request altogether — the person was told to message Sohaib directly and
  // nothing appeared in Settings -> Users to approve. requested_at is what puts
  // them in the Requested queue, and the clear_requested_on_activate trigger
  // takes them back out on approval.
  const admin = createAdminClient();
  const row: Record<string, unknown> = {
    id: user.id,
    email: user.email,
    requested_at: new Date().toISOString(),
  };
  // Only when we have one — an upsert would otherwise blank a name already set.
  if (fullName) row.full_name = fullName;
  const { error } = await admin.from("profiles").upsert(row, { onConflict: "id" });
  if (error) {
    return NextResponse.json(
      { error: "Couldn't save the request. Message Sohaib directly." },
      { status: 502 }
    );
  }

  // Best effort from here: the request is already on the list.
  const res = await notifyAccessRequested({ email: user.email, fullName });
  return NextResponse.json({ ok: true, notified: res.ok });
}
