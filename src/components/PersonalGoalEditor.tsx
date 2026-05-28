"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Tiny inline editor for the LM's personal_goal_pct. Renders a "Set a goal"
 * link when none is set, or the current goal with an Edit affordance.
 */
export function PersonalGoalEditor({ initial }: { initial: number | null }) {
  const router = useRouter();
  const [goal, setGoal] = useState<number | null>(initial);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(initial ?? 75));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function save(next: number | null) {
    setError(null);
    const r = await fetch("/api/me/goal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ goal: next }),
    });
    if (!r.ok) {
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? "Could not save goal.");
      return;
    }
    setGoal(next);
    setEditing(false);
    startTransition(() => router.refresh());
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--text-mute)" }}>
        {goal == null ? (
          <button
            onClick={() => setEditing(true)}
            className="font-semibold hover:underline"
            style={{ color: "var(--accent)" }}
          >
            Set a goal
          </button>
        ) : (
          <>
            <span>
              Goal: <span style={{ color: "var(--text)" }}>{goal}%</span>
            </span>
            <button
              onClick={() => setEditing(true)}
              className="hover:underline"
              style={{ color: "var(--accent)" }}
            >
              Edit
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap text-[11px]">
      <span style={{ color: "var(--text-mute)" }}>Goal:</span>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
        inputMode="numeric"
        className="w-14 text-center rounded px-1.5 py-0.5"
        style={{
          background: "var(--bg-sunken)",
          border: "1px solid var(--border)",
          color: "var(--text)",
        }}
      />
      <span style={{ color: "var(--text-mute)" }}>%</span>
      <button
        onClick={() => save(Number(draft))}
        disabled={pending || draft === ""}
        className="px-2 py-0.5 rounded font-semibold disabled:opacity-50"
        style={{ background: "var(--accent)", color: "var(--accent-text-on)" }}
      >
        Save
      </button>
      {goal != null && (
        <button
          onClick={() => save(null)}
          disabled={pending}
          className="px-2 py-0.5 rounded"
          style={{
            background: "var(--bg-sunken)",
            color: "var(--text-mute)",
            border: "1px solid var(--border)",
          }}
        >
          Clear
        </button>
      )}
      <button
        onClick={() => {
          setEditing(false);
          setDraft(String(goal ?? 75));
        }}
        className="hover:underline"
        style={{ color: "var(--text-mute)" }}
      >
        Cancel
      </button>
      {error && (
        <span className="block w-full mt-1" style={{ color: "var(--error)" }}>
          {error}
        </span>
      )}
    </div>
  );
}
