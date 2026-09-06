"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Step = {
  title: string;
  body: string;
  highlight?: string;
};

const STEPS: Step[] = [
  {
    title: "Welcome to League Health.",
    body:
      "Your daily score, your action list, your trophy cabinet — pulled live from every Brodie app you already use. No new tool to log into. The numbers ARE your work.",
  },
  {
    title: "Today's XP tells you how the day went.",
    body:
      "Each app contributes to your score. The big number at the top is your sum for today. Tap 'Why?' on any app tile to see exactly which sub-metrics drove the number and how to improve each one.",
  },
  {
    title: "Action items are where the points live.",
    body:
      "Green chip = XP you can earn by doing the thing. Red chip = XP you're losing each day until you fix it. Click 'Lock in →' on any row to jump straight to the source app and resolve it. Your score updates after the next sync.",
  },
  {
    title: "Refresh anytime + dispute what's wrong.",
    body:
      "Hit the ↻ Refresh button to pull fresh numbers on demand. Hit 'Why?' on any tile for the math, then 'Dispute' if a metric looks wrong. Your DM sees it in their queue and decides. The system is meant to be challenged.",
  },
];

export function WelcomeTour({ profileId, tourCompletedAt }: { profileId: string; tourCompletedAt: string | null }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!tourCompletedAt) setOpen(true);
  }, [tourCompletedAt]);

  async function finish() {
    const sb = createClient();
    await sb.from("profiles").update({ tour_completed_at: new Date().toISOString() }).eq("id", profileId);
    setOpen(false);
  }

  if (!open) return null;

  const s = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0, 0, 0, 0.6)" }}
    >
      <div
        className="rounded-2xl border max-w-md w-full p-6 brodie-fade-in"
        style={{
          background: "var(--bg-raised)",
          borderColor: "var(--border)",
          boxShadow: "0 30px 80px rgba(0,0,0,0.4)",
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <p
            className="uppercase text-[11px] sm:text-[10px] tracking-[0.08em] font-semibold"
            style={{ color: "var(--accent)" }}
          >
            Step {step + 1} of {STEPS.length}
          </p>
          <button
            onClick={finish}
            className="text-[11px] uppercase tracking-wider"
            style={{ color: "var(--text-mute)" }}
          >
            Skip
          </button>
        </div>
        <h2 className="text-xl font-semibold tracking-tight mb-2" style={{ color: "var(--text)" }}>
          {s.title}
        </h2>
        <p className="text-sm leading-relaxed mb-6" style={{ color: "var(--text-secondary)" }}>
          {s.body}
        </p>
        {/* Step dots */}
        <div className="flex items-center gap-1.5 mb-6">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className="rounded-full transition-all"
              style={{
                width: i === step ? 20 : 6,
                height: 6,
                background: i === step ? "var(--accent)" : "var(--border)",
              }}
            />
          ))}
        </div>
        <div className="flex justify-between gap-2">
          <button
            onClick={() => step > 0 && setStep(step - 1)}
            disabled={step === 0}
            className="text-xs px-3 py-2 rounded-lg disabled:opacity-30"
            style={{
              background: "var(--bg-sunken)",
              color: "var(--text)",
              border: "1px solid var(--border)",
            }}
          >
            ← Back
          </button>
          {isLast ? (
            <button
              onClick={finish}
              className="text-xs px-4 py-2 rounded-lg font-semibold"
              style={{
                background: "var(--accent)",
                color: "var(--accent-text-on)",
              }}
            >
              Let's go →
            </button>
          ) : (
            <button
              onClick={() => setStep(step + 1)}
              className="text-xs px-4 py-2 rounded-lg font-semibold"
              style={{
                background: "var(--accent)",
                color: "var(--accent-text-on)",
              }}
            >
              Next →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
