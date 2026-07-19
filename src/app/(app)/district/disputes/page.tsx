import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { DisputeResolver } from "@/components/DisputeResolver";
import Link from "next/link";

/**
 * DM (or super_admin) triage queue for LM-filed metric disputes.
 * Open ones at the top with full reason + resolver UI. Resolved ones
 * collapsed below for audit.
 */
export default async function DisputesQueue() {
  await requireRole(["dm", "super_admin"]);
  const admin = createAdminClient();

  const { data: open } = await admin
    .from("metric_disputes")
    .select(
      "id, snapshot_date, reason, filed_at, league_managers!inner(id, full_name, email, location_name), metrics!inner(name, slug, apps!inner(name, slug))"
    )
    .eq("status", "open")
    .order("filed_at", { ascending: true });

  const { data: resolved } = await admin
    .from("metric_disputes")
    .select(
      "id, snapshot_date, reason, status, dm_note, score_adjustment, filed_at, resolved_at, league_managers!inner(id, full_name), metrics!inner(name, apps!inner(name))"
    )
    .neq("status", "open")
    .order("resolved_at", { ascending: false })
    .limit(50);

  const openRows = (open ?? []) as unknown as Array<{
    id: string;
    snapshot_date: string;
    reason: string;
    filed_at: string;
    league_managers: { id: string; full_name: string; email: string; location_name: string | null };
    metrics: { name: string; slug: string; apps: { name: string; slug: string } };
  }>;

  const resolvedRows = (resolved ?? []) as unknown as Array<{
    id: string;
    snapshot_date: string;
    reason: string;
    status: string;
    dm_note: string | null;
    score_adjustment: number | null;
    filed_at: string;
    resolved_at: string;
    league_managers: { id: string; full_name: string };
    metrics: { name: string; apps: { name: string } };
  }>;

  return (
    <main className="space-y-8">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="uppercase text-[11px] tracking-[0.08em] font-semibold" style={{ color: "var(--text-mute)" }}>
            Triage
          </p>
          <h1 className="text-3xl font-semibold tracking-tight mt-1">Disputes</h1>
          <p className="text-glass-text-secondary text-sm mt-1">
            LMs flag metrics they think are wrong. You decide if the score gets adjusted.
          </p>
        </div>
        <Link
          href="/district"
          className="text-xs px-3 py-1.5 rounded-full"
          style={{
            background: "var(--bg-raised)",
            color: "var(--text)",
            border: "1px solid var(--border)",
          }}
        >
          Back to district
        </Link>
      </header>

      <section>
        <h2 className="text-base font-semibold mb-3">
          Open ({openRows.length})
        </h2>
        {openRows.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-mute)" }}>
            Nothing to triage. Nice.
          </p>
        ) : (
          <ul className="space-y-3">
            {openRows.map((d) => (
              <li
                key={d.id}
                className="rounded-2xl border p-4"
                style={{ background: "var(--bg-raised)", borderColor: "var(--border)" }}
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="space-y-1 min-w-0">
                    <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                      {d.league_managers.full_name}
                      <span style={{ color: "var(--text-mute)" }}>
                        {" · "}
                        {d.metrics.apps.name} — {d.metrics.name}
                      </span>
                    </p>
                    <p className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text-mute)" }}>
                      For {d.snapshot_date} · filed {new Date(d.filed_at).toLocaleString()}
                    </p>
                  </div>
                  <Link
                    href={`/settings/lm/${d.league_managers.id}`}
                    className="text-[11px] uppercase tracking-wider hover:underline"
                    style={{ color: "var(--accent)" }}
                  >
                    Open LM
                  </Link>
                </div>
                <p
                  className="mt-3 text-sm leading-relaxed whitespace-pre-wrap rounded-xl p-3"
                  style={{
                    background: "var(--bg-sunken)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                  }}
                >
                  {d.reason}
                </p>
                <DisputeResolver disputeId={d.id} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {resolvedRows.length > 0 && (
        <section>
          <h2 className="text-base font-semibold mb-3">Recently resolved</h2>
          <ul className="space-y-2">
            {resolvedRows.map((d) => (
              <li
                key={d.id}
                className="rounded-xl border p-3 text-sm"
                style={{ background: "var(--bg-raised)", borderColor: "var(--border)" }}
              >
                <div className="flex items-baseline justify-between gap-2 flex-wrap">
                  <p style={{ color: "var(--text)" }}>
                    <span
                      className="text-[10px] uppercase tracking-wider font-semibold mr-2 px-2 py-0.5 rounded-full"
                      style={{
                        background:
                          d.status === "approved"
                            ? "rgba(34, 178, 76, 0.12)"
                            : d.status === "rejected"
                            ? "rgba(200, 16, 46, 0.12)"
                            : "var(--bg-sunken)",
                        color:
                          d.status === "approved"
                            ? "var(--ok, #22b24c)"
                            : d.status === "rejected"
                            ? "var(--error)"
                            : "var(--text-mute)",
                      }}
                    >
                      {d.status}
                    </span>
                    {d.league_managers.full_name}{" "}
                    <span style={{ color: "var(--text-mute)" }}>
                      · {d.metrics.apps.name} — {d.metrics.name} · {d.snapshot_date}
                    </span>
                  </p>
                  {d.score_adjustment != null && (
                    <span
                      className="text-[11px] font-mono"
                      style={{
                        color: d.score_adjustment > 0 ? "var(--ok, #22b24c)" : "var(--error)",
                      }}
                    >
                      {d.score_adjustment > 0 ? "+" : ""}
                      {d.score_adjustment} XP
                    </span>
                  )}
                </div>
                {d.dm_note && (
                  <p className="mt-1.5 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                    {d.dm_note}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
