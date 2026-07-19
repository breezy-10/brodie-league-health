import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { WeightEditor } from "@/components/WeightEditor";

export default async function WeightsPage() {
  await requireRole(["dm", "super_admin"]);
  const sb = await createClient();

  const { data: apps } = await sb.from("apps").select("id, slug, name, weight, display_order").order("display_order", { ascending: true });
  const { data: metrics } = await sb.from("metrics").select("id, app_id, slug, name, weight_within_app, direction");
  const { data: history } = await sb
    .from("weight_history")
    .select("id, changed_at, scope, target_id, old_weight, new_weight, note, profiles(email, full_name)")
    .order("changed_at", { ascending: false })
    .limit(20);

  return (
    <main className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Weights</h1>
        <p className="text-glass-text-secondary text-sm mt-1">
          App weights and sub-metric weights both auto-balance to 100. Move one slider and the others adjust proportionally.
        </p>
      </header>

      <WeightEditor
        apps={(apps ?? []) as Array<{ id: string; slug: string; name: string; weight: number }>}
        metrics={(metrics ?? []) as Array<{ id: string; app_id: string; slug: string; name: string; weight_within_app: number; direction: string }>}
      />

      <section>
        <h2 className="text-base font-semibold mb-3">Recent changes</h2>
        <div className="rounded-2xl border border-glass-border bg-glass-surface overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-glass-surface-hover text-glass-text-tertiary uppercase text-[10px] tracking-wider">
              <tr>
                <th className="text-left p-3 font-semibold">When</th>
                <th className="text-left p-3 font-semibold">Who</th>
                <th className="text-left p-3 font-semibold">Scope</th>
                <th className="text-right p-3 font-semibold">Old → New</th>
                <th className="text-left p-3 font-semibold">Note</th>
              </tr>
            </thead>
            <tbody>
              {(history ?? []).map((h) => {
                const row = h as unknown as { id: string; changed_at: string; scope: string; old_weight: number | null; new_weight: number | null; note: string | null; profiles: { email: string; full_name: string } | null };
                return (
                  <tr key={row.id} className="border-t border-glass-border-light">
                    <td className="p-3 font-mono text-xs text-glass-text-tertiary">{row.changed_at.replace("T", " ").slice(0, 16)}</td>
                    <td className="p-3">{row.profiles?.full_name ?? row.profiles?.email ?? "—"}</td>
                    <td className="p-3 text-glass-text-tertiary">{row.scope}</td>
                    <td className="p-3 text-right">{row.old_weight ?? "—"} → {row.new_weight ?? "—"}</td>
                    <td className="p-3 text-glass-text-tertiary">{row.note ?? ""}</td>
                  </tr>
                );
              })}
              {(!history || history.length === 0) && <tr><td colSpan={5} className="p-6 text-center text-glass-text-tertiary">No changes yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
