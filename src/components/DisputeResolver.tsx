"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Inline approve/reject controls on a dispute row. The score-adjustment
 * input only shows when the DM picks Approve.
 */
export function DisputeResolver({ disputeId }: { disputeId: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "approve" | "reject">("idle");
  const [note, setNote] = useState("");
  const [adjustment, setAdjustment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setSubmitting(true);
    const r = await fetch("/api/admin/disputes/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: disputeId,
        decision: mode === "approve" ? "approved" : "rejected",
        dmNote: note,
        scoreAdjustment:
          mode === "approve" && adjustment.trim() ? Number(adjustment) : undefined,
      }),
    });
    setSubmitting(false);
    if (!r.ok) {
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? "Could not resolve. Try again.");
      return;
    }
    router.refresh();
  }

  if (mode === "idle") {
    return (
      <div className="flex gap-2 mt-3">
        <button
          onClick={() => setMode("approve")}
          className="text-xs px-3 py-1.5 rounded-lg font-semibold"
          style={{
            background: "var(--ok-soft, var(--green-tint))",
            color: "var(--ok, #22b24c)",
            border: "1px solid transparent",
          }}
        >
          Approve
        </button>
        <button
          onClick={() => setMode("reject")}
          className="text-xs px-3 py-1.5 rounded-lg font-semibold"
          style={{
            background: "var(--red-tint)",
            color: "var(--error)",
            border: "1px solid transparent",
          }}
        >
          Reject
        </button>
      </div>
    );
  }

  return (
    <div
      className="mt-3 p-3 rounded-xl space-y-2"
      style={{ background: "var(--bg-sunken)" }}
    >
      <p className="text-[11px] font-semibold" style={{ color: "var(--text-mute)" }}>
        {mode === "approve" ? "Approve dispute" : "Reject dispute"}
      </p>

      {mode === "approve" && (
        <div>
          <label className="text-[11px] block mb-1" style={{ color: "var(--text-secondary)" }}>
            XP adjustment (optional, can be negative)
          </label>
          <input
            value={adjustment}
            onChange={(e) => setAdjustment(e.target.value)}
            placeholder="e.g. 4 to credit 4 XP back"
            inputMode="decimal"
            className="w-full text-sm rounded-lg p-2"
            style={{
              background: "var(--bg-raised)",
              border: "1px solid var(--border)",
              color: "var(--text)",
            }}
          />
        </div>
      )}

      <div>
        <label className="text-[11px] block mb-1" style={{ color: "var(--text-secondary)" }}>
          Note to LM (shown when they check the resolved dispute)
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder={mode === "approve" ? "Confirmed, applying credit for 4 outbound touches we missed." : "Touches were inbound replies, not outbound. Won't count."}
          className="w-full text-sm rounded-lg p-2"
          style={{
            background: "var(--bg-raised)",
            border: "1px solid var(--border)",
            color: "var(--text)",
          }}
        />
      </div>

      {error && <p className="text-xs" style={{ color: "var(--error)" }}>{error}</p>}

      <div className="flex justify-end gap-2 pt-1">
        <button
          onClick={() => setMode("idle")}
          disabled={submitting}
          className="text-xs px-3 py-1.5 rounded-lg disabled:opacity-30"
          style={{ background: "var(--bg-raised)", color: "var(--text)", border: "1px solid var(--border)" }}
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={submitting}
          className="text-xs px-3 py-1.5 rounded-lg font-semibold disabled:opacity-50"
          style={{ background: "var(--accent)", color: "var(--accent-text-on)" }}
        >
          {submitting ? "Saving..." : mode === "approve" ? "Approve" : "Reject"}
        </button>
      </div>
    </div>
  );
}
