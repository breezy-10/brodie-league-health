"use client";

import { useMemo, useState } from "react";

type App = { id: string; slug: string; name: string; weight: number };
type Metric = { id: string; app_id: string; slug: string; name: string; weight_within_app: number; direction: string };

/**
 * Smart weights:
 *   - App weights always sum to 100. When you move one slider up by N, the
 *     others lose N proportionally to their current share. Symmetric for down.
 *   - Sub-metric weights inside each app always sum to 100, same logic.
 *   - If a "sibling group" is fully zeroed, the redistribution falls back to
 *     equal split so we never get stuck.
 */
function rebalance(prev: Record<string, number>, changedId: string, nextValue: number): Record<string, number> {
  const TOTAL = 100;
  const ids = Object.keys(prev);
  const others = ids.filter((id) => id !== changedId);
  if (!others.length) return { [changedId]: TOTAL };

  const clampedNext = Math.max(0, Math.min(TOTAL, Math.round(nextValue)));
  const remaining = TOTAL - clampedNext;
  const prevOtherTotal = others.reduce((s, id) => s + (prev[id] ?? 0), 0);

  const out: Record<string, number> = { ...prev, [changedId]: clampedNext };

  if (remaining <= 0) {
    // moved slider all the way up → siblings go to zero
    for (const id of others) out[id] = 0;
    out[changedId] = TOTAL;
    return out;
  }

  if (prevOtherTotal <= 0) {
    // equal split among siblings
    const each = Math.floor(remaining / others.length);
    let leftover = remaining - each * others.length;
    for (const id of others) {
      out[id] = each + (leftover > 0 ? 1 : 0);
      if (leftover > 0) leftover--;
    }
    return out;
  }

  // proportional redistribution
  let assigned = 0;
  const drafts = new Map<string, number>();
  for (const id of others) {
    const share = (prev[id] ?? 0) / prevOtherTotal;
    const raw = remaining * share;
    const floored = Math.floor(raw);
    drafts.set(id, floored);
    assigned += floored;
  }
  // distribute the rounding leftover to siblings with the largest fractional remainders
  const leftover = remaining - assigned;
  const sortedByFrac = others
    .map((id) => ({ id, frac: remaining * ((prev[id] ?? 0) / prevOtherTotal) - (drafts.get(id) ?? 0) }))
    .sort((a, b) => b.frac - a.frac);
  for (let i = 0; i < leftover; i++) {
    const id = sortedByFrac[i % sortedByFrac.length].id;
    drafts.set(id, (drafts.get(id) ?? 0) + 1);
  }
  for (const id of others) out[id] = drafts.get(id) ?? 0;
  out[changedId] = clampedNext;
  return out;
}

export function WeightEditor({ apps, metrics }: { apps: App[]; metrics: Metric[] }) {
  // Normalize starting values to sum-to-100 so the UI is always in valid state.
  const normalizeToHundred = (entries: Array<{ id: string; w: number }>): Record<string, number> => {
    const total = entries.reduce((s, e) => s + e.w, 0);
    if (total <= 0) {
      const each = Math.floor(100 / Math.max(entries.length, 1));
      let leftover = 100 - each * entries.length;
      return Object.fromEntries(entries.map((e) => [e.id, each + (leftover-- > 0 ? 1 : 0)]));
    }
    // Scale + round, then patch the largest one with the remainder.
    const scaled = entries.map((e) => ({ id: e.id, raw: (e.w / total) * 100 }));
    const floored = scaled.map((s) => ({ id: s.id, v: Math.floor(s.raw), frac: s.raw - Math.floor(s.raw) }));
    const sum = floored.reduce((s, f) => s + f.v, 0);
    let leftover = 100 - sum;
    const sortedByFrac = [...floored].sort((a, b) => b.frac - a.frac);
    for (let i = 0; i < leftover; i++) sortedByFrac[i % sortedByFrac.length].v++;
    return Object.fromEntries(floored.map((f) => [f.id, f.v]));
  };

  const [appWeights, setAppWeights] = useState<Record<string, number>>(() =>
    normalizeToHundred(apps.map((a) => ({ id: a.id, w: Number(a.weight) })))
  );

  const metricsByApp = useMemo(() => {
    const m = new Map<string, Metric[]>();
    for (const x of metrics) {
      if (!m.has(x.app_id)) m.set(x.app_id, []);
      m.get(x.app_id)!.push(x);
    }
    return m;
  }, [metrics]);

  const [metricWeights, setMetricWeights] = useState<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const a of apps) {
      const list = metricsByApp.get(a.id) ?? [];
      Object.assign(
        out,
        normalizeToHundred(list.map((m) => ({ id: m.id, w: Number(m.weight_within_app) })))
      );
    }
    return out;
  });

  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function updateApp(id: string, next: number) {
    setAppWeights((prev) => rebalance(prev, id, next));
  }
  function updateMetric(appId: string, metricId: string, next: number) {
    const list = metricsByApp.get(appId) ?? [];
    const ids = list.map((m) => m.id);
    const slice: Record<string, number> = {};
    for (const id of ids) slice[id] = metricWeights[id] ?? 0;
    const rebalanced = rebalance(slice, metricId, next);
    setMetricWeights((prev) => ({ ...prev, ...rebalanced }));
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    const payload = {
      apps: apps.map((a) => ({ id: a.id, weight: appWeights[a.id] })),
      metrics: metrics.map((m) => ({ id: m.id, weight_within_app: metricWeights[m.id] })),
      note: note || undefined,
    };
    const res = await fetch("/api/admin/weights", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      setMsg("Saved. Hit Refresh on the admin page to re-score with the new weights.");
      setNote("");
    } else {
      setMsg("Save failed.");
    }
    setBusy(false);
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-glass-surface p-5 shadow-card">
        <div className="flex justify-between items-baseline mb-4">
          <h2 className="text-base font-semibold">App weights</h2>
          <span className="text-xs text-glass-text-tertiary">Total: 100 (auto-balanced)</span>
        </div>
        <div className="space-y-3">
          {apps.map((a) => {
            const v = appWeights[a.id] ?? 0;
            return (
              <WeightRow
                key={a.id}
                label={a.name}
                value={v}
                share={v}
                shareLabel="of total"
                onChange={(n) => updateApp(a.id, n)}
              />
            );
          })}
        </div>
      </section>

      {apps.map((a) => {
        const list = metricsByApp.get(a.id) ?? [];
        return (
          <section key={a.id} className="rounded-2xl bg-glass-surface p-5 shadow-card">
            <div className="flex justify-between items-baseline mb-4">
              <h3 className="text-sm font-semibold">{a.name} <span className="text-glass-text-tertiary font-normal">· sub-metrics</span></h3>
              <span className="text-xs text-glass-text-tertiary">Total: 100 (auto-balanced)</span>
            </div>
            <div className="space-y-3">
              {list.map((m) => {
                const v = metricWeights[m.id] ?? 0;
                return (
                  <WeightRow
                    key={m.id}
                    label={
                      <>
                        {m.name}{" "}
                        <span className="text-glass-text-tertiary text-xs">
                          ({m.direction === "lower_better" ? "↓ better" : "↑ better"})
                        </span>
                      </>
                    }
                    value={v}
                    share={v}
                    shareLabel={`of ${a.name}`}
                    onChange={(n) => updateMetric(a.id, m.id, n)}
                  />
                );
              })}
            </div>
          </section>
        );
      })}

      <section className="rounded-2xl bg-glass-surface p-5 flex items-end gap-3 flex-wrap shadow-card">
        <div className="flex-1 min-w-[260px]">
          <label className="block text-xs text-glass-text-tertiary mb-1 font-semibold">
            Note (optional, written to audit log)
          </label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g., dialed up facilities after Q2 contract churn"
            className="w-full bg-[var(--input-bg)] border border-glass-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-glass-gold"
          />
        </div>
        <button
          onClick={save}
          disabled={busy}
          className="px-5 py-2.5 rounded-full bg-glass-gold text-[color:var(--on-ink)] font-semibold text-sm disabled:opacity-50 hover:opacity-90 transition"
        >
          {busy ? "Saving..." : "Save weights"}
        </button>
      </section>
      {msg && <p className="text-sm text-glass-text-secondary">{msg}</p>}
    </div>
  );
}

function WeightRow({
  label,
  value,
  share,
  shareLabel,
  onChange,
}: {
  label: React.ReactNode;
  value: number;
  share: number;
  shareLabel: string;
  onChange: (n: number) => void;
}) {
  return (
    <div className="grid grid-cols-12 gap-3 items-center">
      <label className="col-span-4 text-sm">{label}</label>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="col-span-5 accent-glass-gold"
        style={{ accentColor: "var(--glass-gold)" }}
      />
      <input
        type="number"
        value={value}
        min={0}
        max={100}
        onChange={(e) => onChange(Number(e.target.value))}
        className="col-span-1 bg-[var(--input-bg)] border border-glass-border rounded px-2 py-1 text-right text-sm focus:outline-none focus:border-glass-gold"
      />
      <span className="col-span-2 text-right text-xs text-glass-text-tertiary">
        {share}% {shareLabel}
      </span>
    </div>
  );
}
