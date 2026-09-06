"use client";

import { useState } from "react";

/**
 * Tiny "Dispute" link rendered inline next to each metric in the Why? panel.
 * Click → modal with a reason textarea → POST /api/me/disputes.
 *
 * The system is meant to be challenged. If something looks wrong, the LM
 * shouldn't have to email someone — they file here and a DM sees it in
 * their queue.
 */
export function DisputeButton({
  metricId,
  snapshotDate,
  metricLabel,
  appName,
  lmId,
}: {
  metricId: string;
  snapshotDate: string;
  metricLabel: string;
  appName: string;
  /** Optional — pass when an admin is viewing-as another LM, so the dispute
   * gets filed against that LM and not the admin's own row. */
  lmId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filed, setFiled] = useState(false);

  async function submit() {
    setError(null);
    if (reason.trim().length < 4) {
      setError("Add a bit more detail (min 4 chars).");
      return;
    }
    setSubmitting(true);
    const r = await fetch("/api/me/disputes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        metricId,
        snapshotDate,
        reason: reason.trim(),
        lmId,
      }),
    });
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    setSubmitting(false);
    if (!r.ok) {
      setError(j.error ?? "Could not file that. Try again in a sec.");
      return;
    }
    setFiled(true);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-[11px] sm:text-[10px] uppercase tracking-wider transition hover:underline"
        style={{ color: "var(--text-mute)" }}
        aria-label={`Dispute ${metricLabel}`}
      >
        Dispute
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0, 0, 0, 0.6)" }}
          onClick={() => !submitting && setOpen(false)}
        >
          <div
            className="rounded-2xl border max-w-md w-full p-6"
            style={{
              background: "var(--bg-raised)",
              borderColor: "var(--border)",
              boxShadow: "0 30px 80px rgba(0,0,0,0.4)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <p
              className="uppercase text-[11px] sm:text-[10px] tracking-[0.08em] font-semibold"
              style={{ color: "var(--accent)" }}
            >
              Dispute metric
            </p>
            <h2 className="text-lg font-semibold tracking-tight mt-1 mb-1" style={{ color: "var(--text)" }}>
              {metricLabel}
            </h2>
            <p className="text-xs mb-4" style={{ color: "var(--text-mute)" }}>
              {appName} · {snapshotDate}
            </p>

            {filed ? (
              <div className="space-y-3">
                <p className="text-sm" style={{ color: "var(--text)" }}>
                  Filed. Your DM has been notified and will review it shortly.
                </p>
                <button
                  onClick={() => {
                    setOpen(false);
                    setFiled(false);
                    setReason("");
                  }}
                  className="text-xs px-4 py-2 rounded-lg font-semibold"
                  style={{ background: "var(--accent)", color: "var(--accent-text-on)" }}
                >
                  Done
                </button>
              </div>
            ) : (
              <>
                <label className="text-xs block mb-2" style={{ color: "var(--text-secondary)" }}>
                  What's wrong with this metric? Be specific — your DM reads this.
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={5}
                  maxLength={2000}
                  placeholder="e.g. The 4 outbound touches I sent on Tuesday aren't showing — I have screenshots."
                  className="w-full text-sm rounded-lg p-3 mb-2 focus:outline-none focus:ring-2"
                  style={{
                    background: "var(--bg-sunken)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                  }}
                />
                {error && (
                  <p className="text-xs mb-2" style={{ color: "var(--error)" }}>
                    {error}
                  </p>
                )}
                <div className="flex justify-between gap-2 mt-2">
                  <button
                    onClick={() => setOpen(false)}
                    disabled={submitting}
                    className="text-xs px-3 py-2 rounded-lg disabled:opacity-30"
                    style={{
                      background: "var(--bg-sunken)",
                      color: "var(--text)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={submit}
                    disabled={submitting || reason.trim().length < 4}
                    className="text-xs px-4 py-2 rounded-lg font-semibold disabled:opacity-50"
                    style={{ background: "var(--accent)", color: "var(--accent-text-on)" }}
                  >
                    {submitting ? "Filing..." : "File dispute"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
