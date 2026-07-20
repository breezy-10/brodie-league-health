import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Card-grid settings hub (mirrors the Stats Health / Ops Schedule admin layout):
// each admin surface is a card with an optional headline count and a one-line
// description. Roster + Audit live here as cards rather than top-level nav tabs.
export default async function AdminHome() {
  await requireRole(["super_admin"]);
  const sb = createAdminClient();

  const [{ count: lmActive }, { count: userCount }, { count: appCount }, { count: auditCount }] =
    await Promise.all([
      sb.from("league_managers").select("id", { count: "exact", head: true }).eq("active", true),
      sb.from("profiles").select("id", { count: "exact", head: true }),
      sb.from("apps").select("id", { count: "exact", head: true }),
      sb.from("audit_log").select("id", { count: "exact", head: true }),
    ]);

  return (
    <main className="brodie-fade-in">
      <header className="mb-6">
        <p className="font-mono text-xs uppercase tracking-[0.18em] mb-1" style={{ color: "var(--glass-gold)" }}>Admin</p>
        <h1 className="text-3xl font-semibold tracking-tight" style={{ color: "var(--glass-text)" }}>Settings</h1>
        <p className="text-glass-text-secondary text-sm mt-1">Scores, roster, weights, syncs, and the audit trail.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <AdminCard
          href="/settings/users"
          title="Users"
          count={userCount ?? 0}
          sub="Invite staff and manage roles & access. No CRM entry required."
        />
        <AdminCard
          href="/settings/lms"
          title="League managers"
          count={lmActive ?? 0}
          sub="Everyone's score today, ranked, with day-over-day deltas and per-LM metrics."
        />
        <AdminCard
          href="/settings/weights"
          title="Weights"
          count={appCount ?? 0}
          sub="Tune how much each app and metric counts toward the score."
        />
        <AdminCard
          href="/settings/sync"
          title="Sync & refresh"
          sub="Re-run every adapter and re-score all LMs. Review the last sync runs."
        />
        <AdminCard
          href="/settings/setup"
          title="Setup"
          sub="Seed apps and metrics, and check the environment is wired up."
        />
        <AdminCard
          href="/settings/audit-log"
          title="Audit log"
          count={auditCount ?? 0}
          sub="Disputes, weight changes, welcome DMs — the compliance trail."
        />
      </div>
    </main>
  );
}

function AdminCard({ href, title, count, sub }: { href: string; title: string; count?: number; sub: string }) {
  return (
    <Link
      href={href}
      className="block rounded-2xl border border-glass-border bg-glass-surface p-5 transition hover:border-glass-gold hover:bg-glass-surface-hover"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-xl font-semibold" style={{ color: "var(--glass-text)" }}>{title}</h2>
        {count != null && (
          <span className="text-2xl font-bold tabular" style={{ color: "var(--glass-gold)" }}>{count.toLocaleString()}</span>
        )}
      </div>
      <p className="text-sm mt-2 text-glass-text-secondary">{sub}</p>
    </Link>
  );
}
