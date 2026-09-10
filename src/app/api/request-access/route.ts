import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
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

  const res = await notifyAccessRequested({ email: user.email, fullName });
  if (!res.ok) {
    return NextResponse.json(
      { error: "Couldn't send the request. Message Sohaib directly." },
      { status: 502 }
    );
  }
  return NextResponse.json({ ok: true });
}
