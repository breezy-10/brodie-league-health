import type { LiveCounters as Counters } from "@/lib/live-counters";

export function LiveCountersStrip({ counters }: { counters: Counters }) {
  if (!counters.source_available) return null;

  return (
    <section className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
      <CounterCard
        label="Registered teams"
        sublabel="Distinct teams with at least one registered player"
        value={counters.registered_teams}
        accent
      />
      <CounterCard
        label="Registered athletes"
        sublabel="From Player One via CRM sync · your locations"
        value={counters.registered_athletes}
      />
      {/* Slot reserved for an upcoming counter (e.g. captain conversions
          this week). Keeps the grid balanced and signals more is coming. */}
      <CounterCard label="Coming soon" sublabel="More live counters as we add them" value={null} />
    </section>
  );
}

function CounterCard({
  label,
  sublabel,
  value,
  accent = false,
}: {
  label: string;
  sublabel: string;
  value: number | null;
  accent?: boolean;
}) {
  return (
    <div
      className="rounded-2xl border p-3 sm:p-5 brodie-card"
      style={{
        background: "var(--bg-raised)",
        borderColor: accent ? "rgba(242, 169, 0, 0.5)" : "var(--border)",
      }}
    >
      <p
        className="uppercase text-[10px] tracking-[0.08em] font-semibold mb-1"
        style={{ color: accent ? "var(--accent)" : "var(--text-mute)" }}
      >
        {label}
      </p>
      <p className="text-2xl sm:text-4xl font-semibold tracking-tight" style={{ color: "var(--text)" }}>
        {value == null ? <span style={{ color: "var(--text-mute)" }}>—</span> : value.toLocaleString()}
      </p>
      <p className="text-xs mt-1" style={{ color: "var(--text-mute)" }}>{sublabel}</p>
    </div>
  );
}
