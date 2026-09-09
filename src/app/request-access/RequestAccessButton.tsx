"use client";

import { useState } from "react";

export default function RequestAccessButton() {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function submit() {
    setState("sending");
    setMsg("");
    try {
      const res = await fetch("/api/request-access", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Could not send the request");
      }
      setState("sent");
    } catch (err) {
      setState("error");
      setMsg(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  if (state === "sent") {
    return (
      <p style={{ fontSize: 14, fontWeight: 600, color: "#4ade80", margin: 0 }}>
        Request sent. Sohaib has been notified.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
      <button
        type="button"
        onClick={submit}
        disabled={state === "sending"}
        style={{
          padding: "10px 20px",
          borderRadius: 10,
          border: "none",
          background: "#FFB800",
          color: "#000",
          fontSize: 14,
          fontWeight: 700,
          cursor: state === "sending" ? "not-allowed" : "pointer",
          opacity: state === "sending" ? 0.6 : 1,
        }}
      >
        {state === "sending" ? "Sending..." : "Request access"}
      </button>
      {state === "error" ? <span style={{ fontSize: 13, color: "#f87171" }}>{msg}</span> : null}
    </div>
  );
}
