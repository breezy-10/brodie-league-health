"use client";

import { useState } from "react";

const SAMPLE = `email,full_name,location_name,district,slack_user_id
amy@brodierec.com,Amy Correia,Toronto Downtown,GTA,U01ABC123
`;

export function RosterImporter() {
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function upload() {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/admin/roster-import", {
      method: "POST",
      headers: { "content-type": "text/csv" },
      body: csv,
    });
    const j = (await res.json()) as { ok?: boolean; upserted?: number; error?: string };
    if (j.ok) {
      setMsg(`Upserted ${j.upserted} rows.`);
      setCsv("");
      setTimeout(() => window.location.reload(), 800);
    } else {
      setMsg(`Error: ${j.error ?? "unknown"}`);
    }
    setBusy(false);
  }

  return (
    <section className="rounded-xl border border-brodie-line p-5 space-y-3">
      <div className="flex justify-between items-baseline">
        <h2 className="font-display font-bold">Paste CSV</h2>
        <button
          onClick={() => setCsv(SAMPLE)}
          className="text-xs text-brodie-dim hover:text-white"
        >
          Insert sample
        </button>
      </div>
      <textarea
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
        placeholder="email,full_name,location_name,district,slack_user_id"
        rows={6}
        className="w-full bg-black border border-brodie-line rounded p-3 text-xs font-mono"
      />
      <div className="flex gap-3 items-center">
        <button
          onClick={upload}
          disabled={busy || !csv.trim()}
          className="px-3 py-2 rounded bg-brodie-accent text-black font-semibold text-sm disabled:opacity-50"
        >
          {busy ? "Uploading..." : "Upsert"}
        </button>
        {msg && <span className="text-xs text-brodie-dim">{msg}</span>}
      </div>
    </section>
  );
}
