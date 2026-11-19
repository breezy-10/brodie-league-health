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
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not send the request");
      setState("sent");
    } catch (err) {
      setState("error");
      setMsg(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  if (state === "sent") {
    return (
      <p className="auth-body" style={{ color: "var(--green)", fontWeight: 600, margin: 0 }}>
        Your request has been sent to the operations team.
      </p>
    );
  }

  return (
    <>
      <button type="button" className="auth-btn" onClick={submit} disabled={state === "sending"}>
        {state === "sending" ? "Sending…" : "Request access"}
      </button>
      {state === "error" ? <p className="auth-err">{msg}</p> : null}
    </>
  );
}
