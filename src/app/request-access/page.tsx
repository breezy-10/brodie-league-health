import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import RequestAccessButton from "./RequestAccessButton";

// Where the auth gate sends anyone signed in but not on the roster. It must NOT
// call the gate itself or it would bounce in a loop.
export const dynamic = "force-dynamic";

export default async function RequestAccessPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div
        style={{
          width: "100%",
          maxWidth: 440,
          background: "#1c1c1e",
          border: "1px solid #2c2c2e",
          borderRadius: 14,
          padding: 32,
          textAlign: "center",
        }}
      >
        <p
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "#FFB800",
            margin: "0 0 10px",
          }}
        >
          League Health
        </p>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 10px", color: "#f5f5f7" }}>
          You&apos;re not on the list yet
        </h1>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: "#a1a1a6", margin: "0 0 22px" }}>
          League Health is invite only. Ask for access and Sohaib gets a Slack message
          straight away.
        </p>
        <RequestAccessButton />
        <p style={{ fontSize: 12, color: "#6e6e73", margin: "20px 0 0" }}>
          Signed in as {user.email}
        </p>
      </div>
    </div>
  );
}
