import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import Filters, { type FilterOptions } from "./Filters";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// The five domains the dashboard rolls up, in order. Each maps to a source app
// League Health already ingests per-LM into daily_snapshots.
const SECTIONS: { slug: string; title: string; blurb: string }[] = [
  { slug: "crm",            title: "Registrations",             blurb: "Registration pace, lead response, and captain follow-up." },
  { slug: "feedback",       title: "Feedback",                  blurb: "Player and staff feedback signal." },
  { slug: "stats_health",   title: "Stats Health",              blurb: "Game stat logging timeliness." },
  { slug: "content_health", title: "Content Health",            blurb: "Game content posting timeliness." },
  { slug: "checklist",      title: "Season Success Checklist",  blurb: "Season readiness tasks completed on time." },
];

type SnapRow = {
  raw_value: number | null;
  lm_id: string;
  metrics: { name: string; slug: string };
  apps: { slug: string; name: string };
  league_managers: { id: string; full_name: string | null; location_name: string | null; active: boolean };
};

function fmt(slug: string, avg: number): string {
  const rounded = Math.round(avg * 10) / 10;
  const pctish = /(pace|pct|sla|24h|rate|_in_|complete|response)/.test(slug);
  return pctish ? `${Math.round(avg)}%` : `${rounded}`;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; location?: string; lm?: string }>;
}) {
  await requireRole(["dm", "super_admin"]);
  const { season = "current", location = "all", lm = "all" } = await searchParams;
  const admin = createAdminClient();

  const { data: latest } = await admin
    .from("daily_snapshots")
    .select("snapshot_date")
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const snapDate: string | null = latest?.snapshot_date ?? null;

  const { data: lmsRaw } = await admin
    .from("league_managers")
    .select("id, full_name, location_name")
    .eq("active", true)
    .order("full_name");
  const activeLMs = lmsRaw ?? [];

  const snaps: SnapRow[] = snapDate
    ? (((await admin
        .from("daily_snapshots")
        .select("raw_value, lm_id, metrics!inner(name, slug), apps!inner(slug, name), league_managers!inner(id, full_name, location_name, active)")
        .eq("snapshot_date", snapDate)
      ).data) as unknown as SnapRow[]) ?? []
    : [];

  // Apply the location / lead-manager filters (season is not yet a stored
  // dimension — see the note under the header).
  const filtered = snaps.filter((s) => {
    if (!s.league_managers?.active) return false;
    if (location !== "all" && s.league_managers.location_name !== location) return false;
    if (lm !== "all" && s.league_managers.id !== lm) return false;
    return true;
  });

  // Aggregate raw_value per app → per metric across the filtered LMs.
  type MetricAgg = { name: string; slug: string; sum: number; n: number };
  const byApp = new Map<string, { metrics: Map<string, MetricAgg>; lms: Set<string> }>();
  for (const s of filtered) {
    const appSlug = s.apps?.slug;
    if (!appSlug) continue;
    const app = byApp.get(appSlug) ?? { metrics: new Map(), lms: new Set() };
    app.lms.add(s.lm_id);
    if (s.raw_value != null) {
      const m = app.metrics.get(s.metrics.slug) ?? { name: s.metrics.name, slug: s.metrics.slug, sum: 0, n: 0 };
      m.sum += Number(s.raw_value);
      m.n += 1;
      app.metrics.set(s.metrics.slug, m);
    }
    byApp.set(appSlug, app);
  }

  const options: FilterOptions = {
    seasons: [{ value: "current", label: "Current season" }],
    locations: Array.from(new Set(activeLMs.map((l) => l.location_name).filter((l): l is string => !!l))).sort((a, b) => a.localeCompare(b)),
    lms: activeLMs.map((l) => ({ id: l.id, name: l.full_name || "—" })),
  };

  const scopeLabel =
    lm !== "all" ? (activeLMs.find((l) => l.id === lm)?.full_name ?? "1 lead manager")
    : location !== "all" ? location
    : `all ${activeLMs.length} lead managers`;

  return (
    <main className="brodie-fade-in space-y-6">
      <header>
        <p className="font-mono text-xs uppercase tracking-[0.18em] mb-1" style={{ color: "var(--glass-gold)" }}>Dashboard</p>
        <h1 className="text-3xl font-semibold tracking-tight" style={{ color: "var(--glass-text)" }}>League overview</h1>
        <p className="text-sm mt-1 text-glass-text-secondary">
          Cross-app health across registrations, feedback, stats, content, and season readiness — for {scopeLabel}.
          {snapDate ? ` As of ${snapDate}.` : " No snapshot data yet."}
        </p>
      </header>

      <Filters options={options} current={{ season, location, lm }} />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {SECTIONS.map((sec) => {
          const app = byApp.get(sec.slug);
          const metrics = app ? Array.from(app.metrics.values()) : [];
          const lmCount = app?.lms.size ?? 0;
          return (
            <section key={sec.slug} className="rounded-2xl border border-glass-border bg-glass-surface p-5 flex flex-col">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold" style={{ color: "var(--glass-text)" }}>{sec.title}</h2>
                  <p className="text-xs mt-0.5 text-glass-text-tertiary">{sec.blurb}</p>
                </div>
                <span className="text-[10px] uppercase tracking-[0.16em] font-bold text-glass-text-tertiary shrink-0 mt-1">
                  {lmCount} LM{lmCount === 1 ? "" : "s"}
                </span>
              </div>

              <div className="mt-4 space-y-2">
                {metrics.length === 0 ? (
                  <p className="text-sm italic text-glass-text-tertiary py-2">No data for this scope.</p>
                ) : (
                  metrics.map((m) => (
                    <div key={m.slug} className="flex items-center justify-between gap-3 border-t border-glass-border-light pt-2 first:border-t-0 first:pt-0">
                      <span className="text-sm text-glass-text-secondary">{m.name}</span>
                      <span className="text-sm font-semibold tabular" style={{ color: "var(--glass-text)" }}>
                        {m.n ? fmt(m.slug, m.sum / m.n) : "—"}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>

      <p className="text-xs text-glass-text-tertiary">
        Location and lead-manager filters are live. Season filtering is scaffolded — League Health currently stores only
        rolling daily data, so per-season history needs source-app ingestion (happy to wire it next).
      </p>
    </main>
  );
}
