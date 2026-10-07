import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import RequestAccessButton from "./RequestAccessButton";

// Where the auth gate sends anyone signed in but not on the roster. It must NOT
// call the gate itself or it would bounce in a loop.
export const dynamic = "force-dynamic";

const BRODIE_MARK =
  "https://cdn.prod.website-files.com/6921d2c2bd3b56136200df40/6921d2c2bd3b56136200e036_Brodie_Icon.svg";

export default async function RequestAccessPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return (
    <main className="auth-screen">
      <div className="auth-card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="auth-mark" src={BRODIE_MARK} alt="Brodie" />
        <p className="auth-eyebrow">League Health</p>
        <h1 className="auth-title">You&apos;re not on the list yet</h1>
        <p className="auth-body">
          League Health is invite only. Ask for access and Sohaib gets a Slack message straight away.
        </p>
        <RequestAccessButton />
        <p className="auth-foot">Signed in as {user.email}</p>
      </div>
    </main>
  );
}
