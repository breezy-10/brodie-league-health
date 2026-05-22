"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function Login() {
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  async function signInWithGoogle() {
    setLoading(true);
    const next = new URLSearchParams(window.location.search).get("next") || "/";
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-8 bg-brodie-ink text-brodie-fg">
      <div className="w-full max-w-sm">
        <h1 className="text-3xl font-display font-bold mb-2">League Health</h1>
        <p className="text-brodie-dim mb-8">Brodie Rec. League ops scoreboard.</p>
        <button
          onClick={signInWithGoogle}
          disabled={loading}
          className="w-full px-4 py-3 rounded bg-brodie-accent text-black font-semibold hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Redirecting..." : "Sign in with Google"}
        </button>
      </div>
    </main>
  );
}
