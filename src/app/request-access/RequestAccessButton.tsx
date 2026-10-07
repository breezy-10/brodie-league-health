"use client";

import { useState } from "react";

export default function RequestAccessButton() {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [msg, setMsg] = useState("");
  // The request is on the list either way; this only says whether the Slack
  // nudge went with it, so nobody is told they were announced when they weren't.
  const [notified, setNotified] = useState(true);

  async function submit() {
    setState("sending");
    setMsg("");
    try {
      const res = await fetch("/api/request-access", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not send the request");
      setNotified(data.notified !== false);
      setState("sent");
    } catch (err) {
      setState("error");
      setMsg(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  if (state === "sent") {
    return (
      <p className="auth-body" style={{ color: "var(--green)", fontWeight: 600, margin: 0 }}>
        {notified
          ? "Request sent. Sohaib has been notified."
          : "Request sent. It's on Sohaib's list, so message him if it's urgent."}
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
