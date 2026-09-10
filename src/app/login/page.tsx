"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const BRODIE_B =
  "https://cdn.prod.website-files.com/6921d2c2bd3b56136200df40/69a89a46fa2d0409248fc26f_brodie-b-white.svg";
const ALLOWED_DOMAIN = process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN ?? "brodierec.com";

function LoginInner() {
  const params = useSearchParams();
  // Relative paths only: a full URL would be an open redirect, and
  // "//evil.com" parses as protocol-relative.
  const rawNext = params.get("next");
  const next =
    rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";
  const [loading, setLoading] = useState(false);

  async function signIn() {
    setLoading(true);
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        queryParams: {
          hd: ALLOWED_DOMAIN,
          prompt: "select_account",
        },
      },
    });
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background:
          "radial-gradient(circle at 25% 20%, rgba(255, 184, 0, 0.08), transparent 55%), radial-gradient(circle at 80% 80%, rgba(0, 122, 255, 0.05), transparent 55%), #000",
      }}
    >
      <div
        className="brodie-fade-in"
        style={{
          width: 420,
          padding: 36,
          borderRadius: 16,
          background: "#1c1c1e",
          border: "1px solid #2c2c2e",
          boxShadow: "0 30px 80px rgba(0, 0, 0, 0.35)",
        }}
      >
        <img
          src={BRODIE_B}
          alt="Brodie"
          style={{ height: 36, width: "auto", display: "block", marginBottom: 20 }}
        />
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#FFB800",
            marginBottom: 6,
          }}
        >
          Brodie League Health
        </div>
        <h1
          style={{
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color: "#f5f5f7",
            margin: 0,
            marginBottom: 8,
            lineHeight: 1.15,
          }}
        >
          Run your league.
        </h1>
        <p
          style={{
            fontSize: 14,
            color: "#a1a1a6",
            marginTop: 0,
            marginBottom: 28,
            lineHeight: 1.5,
          }}
        >
          Daily score, action checklist, and leaderboard for every league manager. Sign in with your @{ALLOWED_DOMAIN} Google account.
        </p>
        <button
          onClick={signIn}
          disabled={loading}
          style={{
            width: "100%",
            height: 44,
            borderRadius: 12,
            border: "1px solid #38383a",
            background: "#000",
            color: "#f5f5f7",
            fontSize: 14,
            fontWeight: 600,
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.6 : 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            transition: "background 120ms ease, border-color 120ms ease",
          }}
          onMouseEnter={(e) => {
            if (loading) return;
            e.currentTarget.style.background = "#2c2c2e";
            e.currentTarget.style.borderColor = "#636366";
          }}
          onMouseLeave={(e) => {
            if (loading) return;
            e.currentTarget.style.background = "#000";
            e.currentTarget.style.borderColor = "#38383a";
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          {loading ? "Redirecting..." : "Continue with Google"}
        </button>
        <p
          style={{
            fontSize: 11,
            color: "#636366",
            marginTop: 20,
            marginBottom: 0,
            lineHeight: 1.7,
          }}
        >
          Restricted to @{ALLOWED_DOMAIN} accounts.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
