"use client";

import { useMemo, useState } from "react";

type App = { id: string; slug: string; name: string; weight: number };
type Metric = { id: string; app_id: string; slug: string; name: string; weight_within_app: number; direction: string };

export function WeightEditor({ apps, metrics }: { apps: App[]; metrics: Metric[] }) {
  const [appWeights, setAppWeights] = useState<Record<string, number>>(
    Object.fromEntries(apps.map((a) => [a.id, Number(a.weight)]))
  );
  const [metricWeights, setMetricWeights] = useState<Record<string, number>>(
    Object.fromEntries(metrics.map((m) => [m.id, Number(m.weight_within_app)]))
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const totalAppWeight = useMemo(
    () => Object.values(appWeights).reduce((s, n) => s + Number(n), 0),
    [appWeights]
  );

  const metricsByApp = useMemo(() => {
    const m = new Map<string, Metric[]>();
    for (const x of metrics) {
      if (!m.has(x.app_id)) m.set(x.app_id, []);
      m.get(x.app_id)!.push(x);
    }
    return m;
  }, [metrics]);

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
      <section className="rounded-xl border border-brodie-line p-5">
        <div className="flex justify-between items-end mb-3">
          <h2 className="text-lg font-display font-bold">App weights</h2>
          <span className="text-xs text-brodie-dim">Total: {totalAppWeight.toFixed(0)} (normalized at scoring)</span>
        </div>
        <div className="space-y-3">
          {apps.map((a) => {
            const v = appWeights[a.id];
            const share = totalAppWeight ? (v / totalAppWeight) * 100 : 0;
            return (
              <div key={a.id} className="grid grid-cols-12 gap-3 items-center">
                <label className="col-span-3 text-sm">{a.name}</label>
                <input
                  type="range"
                  min={0}
                  max={50}
                  value={v}
                  onChange={(e) => setAppWeights({ ...appWeights, [a.id]: Number(e.target.value) })}
                  className="col-span-6 accent-brodie-accent"
                />
                <input
                  type="number"
                  value={v}
                  min={0}
                  onChange={(e) => setAppWeights({ ...appWeights, [a.id]: Number(e.target.value) })}
                  className="col-span-1 bg-black border border-brodie-line rounded px-2 py-1 text-right text-sm"
                />
                <span className="col-span-2 text-right text-xs text-brodie-dim">{share.toFixed(1)}% of total</span>
              </div>
            );
          })}
        </div>
      </section>

      {apps.map((a) => {
        const list = metricsByApp.get(a.id) ?? [];
        const subTotal = list.reduce((s, m) => s + Number(metricWeights[m.id] ?? 0), 0);
        return (
          <section key={a.id} className="rounded-xl border border-brodie-line p-5">
            <div className="flex justify-between items-end mb-3">
              <h3 className="text-base font-display font-bold">{a.name} · sub-metrics</h3>
              <span className="text-xs text-brodie-dim">Total: {subTotal.toFixed(0)}</span>
            </div>
            <div className="space-y-3">
              {list.map((m) => {
                const v = metricWeights[m.id];
                const share = subTotal ? (v / subTotal) * 100 : 0;
                return (
                  <div key={m.id} className="grid grid-cols-12 gap-3 items-center">
                    <label className="col-span-4 text-sm">{m.name} <span className="text-brodie-dim text-xs">({m.direction === "lower_better" ? "↓ better" : "↑ better"})</span></label>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={v}
                      onChange={(e) => setMetricWeights({ ...metricWeights, [m.id]: Number(e.target.value) })}
                      className="col-span-5 accent-brodie-accent"
                    />
                    <input
                      type="number"
                      value={v}
                      min={0}
                      onChange={(e) => setMetricWeights({ ...metricWeights, [m.id]: Number(e.target.value) })}
                      className="col-span-1 bg-black border border-brodie-line rounded px-2 py-1 text-right text-sm"
                    />
                    <span className="col-span-2 text-right text-xs text-brodie-dim">{share.toFixed(0)}% of {a.name}</span>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      <section className="flex items-end gap-3">
        <div className="flex-1">
          <label className="block text-xs text-brodie-dim mb-1">Note (optional, written to audit log)</label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g., dialed up facilities after Q2 contract churn"
            className="w-full bg-black border border-brodie-line rounded px-3 py-2 text-sm"
          />
        </div>
        <button
          onClick={save}
          disabled={busy}
          className="px-4 py-2 rounded bg-brodie-accent text-black font-semibold disabled:opacity-50"
        >
          {busy ? "Saving..." : "Save weights"}
        </button>
      </section>
      {msg && <p className="text-sm text-brodie-dim">{msg}</p>}
    </div>
  );
}
