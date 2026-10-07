import { requireRole } from "@/lib/auth";
import { sourceConfigured, type AppSlug } from "@/lib/source-apps/clients";
import { createAdminClient } from "@/lib/supabase/admin";
import { SeedDemoButton } from "@/components/SeedDemoButton";

type Check = { name: string; ok: boolean; detail?: string };

async function buildChecks(): Promise<Check[]> {
  const checks: Check[] = [];

  checks.push({
    name: "ALLOWED_EMAIL_DOMAIN",
    ok: !!process.env.ALLOWED_EMAIL_DOMAIN,
    detail: process.env.ALLOWED_EMAIL_DOMAIN ?? "Defaults to brodierec.com.",
  });
  checks.push({
    name: "CRON_SECRET",
    ok: !!process.env.CRON_SECRET,
    detail: process.env.CRON_SECRET ? "Set." : "Without this, cron endpoints are open.",
  });
  checks.push({
    name: "SLACK_BOT_TOKEN",
    ok: !!process.env.SLACK_BOT_TOKEN,
    detail: process.env.SLACK_BOT_TOKEN ? "Set." : "Slack digest will skip.",
  });

  const apps: Array<{ slug: AppSlug; name: string }> = [
    { slug: "crm", name: "Brodie CRM" },
    { slug: "facilities", name: "Facilities" },
    { slug: "ref_payroll", name: "Ref Payroll" },
    { slug: "training", name: "Training" },
    { slug: "stats_health", name: "Stats Health" },
    { slug: "content_health", name: "Content Health" },
    { slug: "ops_schedule", name: "Ops Schedule" },
  ];
  for (const a of apps) {
    const cfg = sourceConfigured(a.slug);
    checks.push({
      name: `${a.name} adapter`,
      ok: cfg,
      detail: cfg ? "URL + service-role key present." : `Set ${a.slug.toUpperCase()}_SUPABASE_URL and _SERVICE_ROLE_KEY.`,
    });
  }

  try {
    const sb = createAdminClient();
    const { count } = await sb.from("apps").select("*", { count: "exact", head: true });
    checks.push({ name: "Schema applied", ok: (count ?? 0) >= 7, detail: `${count} app rows seeded.` });
  } catch (e: unknown) {
    checks.push({ name: "Schema applied", ok: false, detail: e instanceof Error ? e.message : String(e) });
  }

  return checks;
}

export default async function SetupDoctor() {
  await requireRole(["super_admin"]);
  const checks = await buildChecks();
  const allOk = checks.every((c) => c.ok);
  return (
    <main className="space-y-6">

      <div className={`rounded-2xl border p-4 ${allOk ? "border-transparent bg-[color:var(--green-tint)]" : "border-transparent bg-[color:var(--amber-tint)]"}`}>
        <p className="font-semibold">{allOk ? "All checks pass." : "Some checks are red — see below."}</p>
      </div>

      <SeedDemoButton />

      <div className="rounded-2xl bg-glass-surface overflow-hidden shadow-card">
        <table className="w-full text-sm">
          <thead className="bg-glass-surface-hover text-glass-text-tertiary text-xs">
            <tr>
              <th className="text-left p-3 w-10"></th>
              <th className="text-left p-3 font-semibold">Check</th>
              <th className="text-left p-3 font-semibold">Detail</th>
            </tr>
          </thead>
          <tbody>
            {checks.map((c) => (
              <tr key={c.name} className="border-t border-glass-border-light">
                <td className="p-3 text-lg">{c.ok ? <span className="text-[color:var(--green)]">●</span> : <span className="text-[color:var(--red)]">●</span>}</td>
                <td className="p-3 font-mono text-xs">{c.name}</td>
                <td className="p-3 text-glass-text-tertiary text-xs">{c.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
