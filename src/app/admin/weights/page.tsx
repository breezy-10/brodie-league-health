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
        <h1 className="text-3xl font-display font-bold">Weights</h1>
        <p className="text-brodie-dim text-sm">App weights are relative — they get normalized at scoring time. Same for sub-metric weights inside each app.</p>
      </header>
      <WeightEditor
        apps={(apps ?? []) as Array<{ id: string; slug: string; name: string; weight: number }>}
        metrics={(metrics ?? []) as Array<{ id: string; app_id: string; slug: string; name: string; weight_within_app: number; direction: string }>}
      />

      <section>
        <h2 className="text-lg font-display font-bold mb-3">Recent changes</h2>
        <div className="rounded-xl border border-brodie-line overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-black/40 text-brodie-dim uppercase text-xs">
              <tr>
                <th className="text-left p-3">When</th>
                <th className="text-left p-3">Who</th>
                <th className="text-left p-3">Scope</th>
                <th className="text-right p-3">Old → New</th>
                <th className="text-left p-3">Note</th>
              </tr>
            </thead>
            <tbody>
              {(history ?? []).map((h) => {
                const row = h as unknown as { id: string; changed_at: string; scope: string; old_weight: number | null; new_weight: number | null; note: string | null; profiles: { email: string; full_name: string } | null };
                return (
                  <tr key={row.id} className="border-t border-brodie-line">
                    <td className="p-3 font-mono text-xs text-brodie-dim">{row.changed_at.replace("T", " ").slice(0, 16)}</td>
                    <td className="p-3">{row.profiles?.full_name ?? row.profiles?.email ?? "—"}</td>
                    <td className="p-3 text-brodie-dim">{row.scope}</td>
                    <td className="p-3 text-right">{row.old_weight ?? "—"} → {row.new_weight ?? "—"}</td>
                    <td className="p-3 text-brodie-dim">{row.note ?? ""}</td>
                  </tr>
                );
              })}
              {(!history || history.length === 0) && <tr><td colSpan={5} className="p-6 text-center text-brodie-dim">No changes yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
