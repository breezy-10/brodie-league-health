"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveReferralRates } from "./actions";

function Spinner() {
  return (
    <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

const INPUT =
  "w-28 rounded-lg border border-glass-border bg-glass-surface pl-6 pr-3 py-2 text-sm text-glass-text tabular focus:outline-none focus:border-glass-gold transition disabled:opacity-50";

export type CurrencyCounts = {
  currency: string; new_athletes: number; returning_athletes: number; total: number;
  /** What ops actually recorded owed to referrers, for reconciling the projection. */
  earned: number;
};

export default function RatesEditor({
  season,
  rates,
  canEdit,
  counts,
}: {
  season: string;
  rates: { new_athlete_payment: number; returning_athlete_payment: number; registrant_discount: number; stored: boolean };
  canEdit: boolean;
  counts: CurrencyCounts[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [newPay, setNewPay] = useState(String(rates.new_athlete_payment));
  const [retPay, setRetPay] = useState(String(rates.returning_athlete_payment));
  const [discount, setDiscount] = useState(String(rates.registrant_discount));
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const n = (v: string) => (v.trim() === "" ? NaN : Number(v));
  const parsed = { newPay: n(newPay), retPay: n(retPay), discount: n(discount) };
  const valid = Object.values(parsed).every((v) => Number.isFinite(v) && v >= 0 && v <= 1000);
  const dirty =
    parsed.newPay !== rates.new_athlete_payment ||
    parsed.retPay !== rates.returning_athlete_payment ||
    parsed.discount !== rates.registrant_discount;

  // What the season costs at whatever is currently typed in, so the effect of a
  // change is visible before it is saved. Each currency stays separate.
  // The discount applies to new athletes only — it comes off a first
  // registration, so a run-it-back pays the referrer but costs no discount.
  const projection = counts.map((c) => {
    const payments = valid ? c.new_athletes * parsed.newPay + c.returning_athletes * parsed.retPay : 0;
    const discounts = valid ? c.new_athletes * parsed.discount : 0;
    // Gap between what these terms imply and what ops actually credited. Only
    // meaningful while the boxes still hold the saved terms — mid-edit this is
    // a what-if, so a comparison against recorded amounts means nothing.
    const drift = Math.round((payments - c.earned) * 100) / 100;
    return { currency: c.currency, payments, discounts, total: payments + discounts, earned: c.earned, drift };
  });
  const fmt = (v: number, cur: string) =>
    `$${v.toLocaleString("en-US", { minimumFractionDigits: v % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })} ${cur}`;

  function save() {
    if (!dirty || !valid) return;
    setMsg(null);
    startTransition(async () => {
      const res = await saveReferralRates({
        season,
        newAthletePayment: parsed.newPay,
        returningAthletePayment: parsed.retPay,
        registrantDiscount: parsed.discount,
      });
      if ("error" in res) setMsg({ kind: "error", text: res.error });
      else {
        setMsg({ kind: "ok", text: `Saved for ${season}.` });
        router.refresh();
      }
    });
  }

  return (
    <div className="rounded-2xl border border-glass-border bg-glass-surface p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-base font-semibold" style={{ color: "var(--glass-text)" }}>
            {season} terms
          </h3>
          <p className="text-xs mt-0.5 text-glass-text-tertiary">
            {canEdit
              ? "What the referrer is paid and what the referred athlete gets off their registration. Set per season."
              : "Set per season by operations leadership or a super admin."}
            {!rates.stored && " Currently on the default terms."}
          </p>
        </div>
        {canEdit && (
          <button
            onClick={save}
            disabled={pending || !dirty || !valid}
            className={`inline-flex items-center gap-2 rounded-lg font-semibold text-sm px-5 py-2 transition ${
              pending
                ? "border border-glass-border bg-glass-surface text-glass-text cursor-default"
                : dirty && valid
                  ? "bg-glass-gold text-black hover:brightness-110"
                  : "bg-glass-gold text-black opacity-40 cursor-default"
            }`}
          >
            {pending && <Spinner />}
            {pending ? "Saving…" : dirty ? "Save" : "Saved"}
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-4 mt-4">
        <Field label="New athlete payment" hint="to the referrer">
          <Money value={newPay} onChange={setNewPay} disabled={!canEdit || pending} />
        </Field>
        <Field label="Returning payment" hint="to the referrer">
          <Money value={retPay} onChange={setRetPay} disabled={!canEdit || pending} />
        </Field>
        <Field label="Registrant discount" hint="off a new athlete's first registration">
          <Money value={discount} onChange={setDiscount} disabled={!canEdit || pending} />
        </Field>
      </div>

      {/* Cost of the season at the amounts currently in the boxes. */}
      <div className="mt-4 pt-3.5" style={{ borderTop: "1px solid var(--glass-border)" }}>
        <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-glass-text-tertiary">
          Cost at these terms
        </p>
        {!valid ? (
          <p className="text-xs mt-1.5" style={{ color: "var(--glass-warning-text, var(--glass-gold))" }}>
            Enter an amount between $0 and $1,000 in each box.
          </p>
        ) : projection.length === 0 ? (
          <p className="text-xs mt-1.5 text-glass-text-tertiary">No referrals in this scope yet.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-x-8 gap-y-2 mt-1.5">
              {projection.map((p) => (
                <div key={p.currency}>
                  <div className="text-lg font-bold tabular" style={{ color: "var(--glass-text)" }}>
                    {fmt(p.total, p.currency)}
                  </div>
                  <div className="text-[11px] text-glass-text-tertiary">
                    {fmt(p.payments, p.currency)} to referrers · {fmt(p.discounts, p.currency)} in discounts
                  </div>
                </div>
              ))}
            </div>
            {/* At rest these terms should reproduce what ops credited. Where they
                don't, say so — otherwise this figure and the table's total cost
                disagree with no explanation. */}
            {!dirty && projection.some((p) => p.drift !== 0) && (
              <p className="text-[11px] mt-2.5 text-glass-text-tertiary">
                {projection.filter((p) => p.drift !== 0).map((p) =>
                  `Ops credited ${fmt(p.earned, p.currency)} to referrers, ${fmt(Math.abs(p.drift), p.currency)} ${p.drift > 0 ? "below" : "above"} these terms`,
                ).join(" · ")}
                . The table&apos;s total cost uses the recorded figure, so it differs by that much.
              </p>
            )}
          </>
        )}
      </div>

      {msg && (
        <p className="text-xs mt-3" style={{
          color: msg.kind === "ok"
            ? "var(--glass-success-text, rgb(74,222,128))"
            : "var(--glass-danger-text, rgb(248,113,113))",
        }}>
          {msg.text}
        </p>
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-[0.16em] font-bold text-glass-text-tertiary">{label}</span>
      {children}
      <span className="text-[10px] text-glass-text-tertiary">{hint}</span>
    </label>
  );
}

function Money({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled: boolean }) {
  return (
    <span className="relative inline-flex items-center">
      <span className="absolute left-3 text-sm text-glass-text-tertiary pointer-events-none">$</span>
      <input
        type="number"
        min={0}
        max={1000}
        step="0.01"
        inputMode="decimal"
        className={INPUT}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </span>
  );
}
