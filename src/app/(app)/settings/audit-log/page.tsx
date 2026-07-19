import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import Link from "next/link";

const ACTION_LABELS: Record<string, string> = {
  dispute_filed: "Dispute filed",
  dispute_resolved: "Dispute resolved",
  weight_changed: "Weight changed",
  view_as_opened: "Admin viewed LM",
  welcome_sent: "Welcome DM sent",
  goal_set: "Personal goal set",
};

const ACTION_COLORS: Record<string, string> = {
  dispute_filed: "var(--accent)",
  dispute_resolved: "var(--ok, #22b24c)",
  weight_changed: "var(--error)",
  view_as_opened: "var(--text-mute)",
  welcome_sent: "var(--accent)",
  goal_set: "var(--ok, #22b24c)",
};

export default async function AuditLog({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; actor?: string }>;
}) {
  await requireRole(["dm", "super_admin"]);
  const { action, actor } = await searchParams;
  const admin = createAdminClient();

  let q = admin
    .from("audit_log")
    .select("id, created_at, actor_id, actor_email, action, target_type, target_id, payload")
    .order("created_at", { ascending: false })
    .limit(200);
  if (action) q = q.eq("action", action);
  if (actor) q = q.ilike("actor_email", `%${actor}%`);

  const { data: rows } = await q;
  const list = (rows ?? []) as Array<{
    id: string;
    created_at: string;
    actor_id: string | null;
    actor_email: string | null;
    action: string;
    target_type: string | null;
    target_id: string | null;
    payload: Record<string, unknown>;
  }>;

  const allActions = Object.keys(ACTION_LABELS);

  return (
    <main className="space-y-6">
      <header>
        <p className="uppercase text-[11px] tracking-[0.08em] font-semibold" style={{ color: "var(--text-mute)" }}>
          Compliance
        </p>
        <h1 className="text-3xl font-semibold tracking-tight mt-1">Audit log</h1>
        <p className="text-glass-text-secondary text-sm mt-1">
          Append-only ledger. Most recent 200 events.
        </p>
      </header>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2">
        <Link
          href="/settings/audit-log"
          className="text-xs px-3 py-1.5 rounded-full font-semibold"
          style={{
            background: !action ? "var(--accent)" : "var(--bg-raised)",
            color: !action ? "var(--accent-text-on)" : "var(--text)",
            border: !action ? "1px solid var(--accent)" : "1px solid var(--border)",
          }}
        >
          All
        </Link>
        {allActions.map((a) => (
          <Link
            key={a}
            href={`/settings/audit-log?action=${a}`}
            className="text-xs px-3 py-1.5 rounded-full font-semibold"
            style={{
              background: action === a ? "var(--accent)" : "var(--bg-raised)",
              color: action === a ? "var(--accent-text-on)" : "var(--text)",
              border: action === a ? "1px solid var(--accent)" : "1px solid var(--border)",
            }}
          >
            {ACTION_LABELS[a] ?? a}
          </Link>
        ))}
      </div>

      <section
        className="rounded-2xl border overflow-hidden"
        style={{ background: "var(--bg-raised)", borderColor: "var(--border)" }}
      >
        {list.length === 0 ? (
          <p className="p-6 text-sm text-center" style={{ color: "var(--text-mute)" }}>
            No events yet for this filter.
          </p>
        ) : (
          <ul>
            {list.map((r) => (
              <li
                key={r.id}
                className="px-4 py-3 border-t first:border-t-0"
                style={{ borderColor: "var(--border)" }}
              >
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <div className="flex items-baseline gap-2 min-w-0">
                    <span
                      className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full"
                      style={{
                        background: "var(--bg-sunken)",
                        color: ACTION_COLORS[r.action] ?? "var(--text-mute)",
                        border: `1px solid ${ACTION_COLORS[r.action] ?? "var(--border)"}`,
                      }}
                    >
                      {ACTION_LABELS[r.action] ?? r.action}
                    </span>
                    <span className="text-sm truncate" style={{ color: "var(--text)" }}>
                      {r.actor_email ?? "system"}
                    </span>
                  </div>
                  <span className="text-[11px] whitespace-nowrap" style={{ color: "var(--text-mute)" }}>
                    {new Date(r.created_at).toLocaleString()}
                  </span>
                </div>
                {Object.keys(r.payload ?? {}).length > 0 && (
                  <pre
                    className="mt-2 text-[11px] leading-relaxed rounded-lg p-2 overflow-x-auto"
                    style={{
                      background: "var(--bg-sunken)",
                      color: "var(--text-secondary)",
                      border: "1px solid var(--border)",
                      fontFamily: "ui-monospace, SF Mono, monospace",
                    }}
                  >
                    {JSON.stringify(r.payload, null, 2)}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
