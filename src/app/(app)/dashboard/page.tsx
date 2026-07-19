import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import Filters, { type FilterOptions } from "./Filters";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Deep links to each source app's dashboard ("More details →").
const APP_URL: Record<string, string> = {
  crm: "https://brodie-crm-pro.vercel.app",
  promo: "https://registration-promo-tracker.vercel.app",
  feedback: "https://brodie-feedback.vercel.app",
  stats_health: "https://brodie-stats-health.vercel.app",
  content_health: "https://brodie-content-health.vercel.app",
  checklist: "https://brodie-season-success-checklist.vercel.app",
  overdue: "https://brodie-overdue-payments.vercel.app",
};

type Tone = "default" | "ok" | "warn" | "bad";
type Tile = {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  lines?: { text: string; strong?: boolean }[];
  tone?: Tone;
  link?: { href: string; label: string };
};

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

// --- Sample cards (structure-first; wired to live source data in a follow-up) ---
const SAMPLE: Record<string, Tile[]> = {
  promo: [
    { label: "Teams registered", value: "365", sub: "across 19 locations" },
    { label: "Stories posted", value: "322", unit: "/ 365", sub: "88%", tone: "warn" },
    { label: "Highlights posted", value: "322", unit: "/ 365", sub: "88%", tone: "warn" },
    { label: "Avg time to post", value: "14h 40m", sub: "340 posts", tone: "warn" },
  ],
  feedback: [
    { label: "Responses", value: "2,477" },
    { label: "CSAT", value: "77%", sub: "145 of 188 rated 8 or higher", tone: "ok" },
    { label: "NPS", value: "28", sub: "53% promoters (972) · 25% detractors (460) of 1,850 scored", tone: "warn" },
    { label: "Returning intent", value: "52%", sub: "1,136 yes · 646 thinking · 408 no" },
  ],
  checklist: [
    { label: "Tasks complete", value: "39%", sub: "393 / 1,000", tone: "bad" },
    { label: "Overdue tasks", value: "231", sub: "Across all your checklists", tone: "bad" },
  ],
  stats_health: [
    {
      label: "Stats completion rate",
      value: "98%",
      tone: "ok",
      lines: [
        { text: "834 — total games played", strong: true },
        { text: "2,018 — total games tracked", strong: true },
        { text: "1,901 — BallerTV" },
        { text: "11 — LiveBarn" },
        { text: "58 — In-venue" },
        { text: "48 — No stats" },
      ],
    },
    {
      label: "Full recording %",
      value: "91%",
      tone: "ok",
      lines: [
        { text: "1,845 — full" },
        { text: "173 — incomplete" },
        { text: "2,018 — total" },
      ],
    },
    {
      label: "Spare players",
      value: "464",
      tone: "warn",
      lines: [
        { text: "297 — games with spares" },
        { text: "464 — spare appearances" },
      ],
      link: { href: "https://brodie-stats-health.vercel.app", label: "See games with spares →" },
    },
  ],
};

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

  const filtered = snaps.filter((s) => {
    if (!s.league_managers?.active) return false;
    if (location !== "all" && s.league_managers.location_name !== location) return false;
    if (lm !== "all" && s.league_managers.id !== lm) return false;
    return true;
  });

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
  const realTiles = (slug: string): Tile[] => {
    const app = byApp.get(slug);
    if (!app) return [];
    return Array.from(app.metrics.values()).map((m) => ({
      label: m.name,
      value: m.n ? fmt(m.slug, m.sum / m.n) : "—",
    }));
  };

  const options: FilterOptions = {
    seasons: [{ value: "current", label: "Current season" }],
    locations: Array.from(new Set(activeLMs.map((l) => l.location_name).filter((l): l is string => !!l))).sort((a, b) => a.localeCompare(b)),
    lms: activeLMs.map((l) => ({ id: l.id, name: l.full_name || "—" })),
  };

  const scopeLabel =
    lm !== "all" ? (activeLMs.find((l) => l.id === lm)?.full_name ?? "1 league manager")
    : location !== "all" ? location
    : `all ${activeLMs.length} league managers`;

  return (
    <main className="brodie-fade-in space-y-8">
      <header>
        <p className="font-mono text-xs uppercase tracking-[0.18em] mb-1" style={{ color: "var(--glass-gold)" }}>Dashboard</p>
        <h1 className="text-3xl font-semibold tracking-tight" style={{ color: "var(--glass-text)" }}>League overview</h1>
        <p className="text-sm mt-1 text-glass-text-secondary">
          Cross-app health for {scopeLabel}.{snapDate ? ` As of ${snapDate}.` : ""}
        </p>
      </header>

      <Filters options={options} current={{ season, location, lm }} />

      <div className="space-y-8">
        <Section title="Registrations" href={APP_URL.crm} tiles={realTiles("crm")} />
        <Section title="Registration Promo Tracker" href={APP_URL.promo} tiles={SAMPLE.promo} sample />
        <Section title="Feedback" href={APP_URL.feedback} tiles={SAMPLE.feedback} sample />
        <Section title="Stats Health" href={APP_URL.stats_health} tiles={SAMPLE.stats_health} sample />
        <Section title="Content Health" href={APP_URL.content_health} tiles={realTiles("content_health")} />
        <Section title="Season Success Checklist" href={APP_URL.checklist} tiles={SAMPLE.checklist} sample />
        <Section title="Overdue Payments" href={APP_URL.overdue} tiles={[]} sample />
      </div>

      <p className="text-xs text-glass-text-tertiary">
        Live sections (Registrations, Content Health) respond to the Location and League-manager filters.
        Sections marked <span className="uppercase tracking-wider font-bold">sample</span> show the target layout and
        link out to the live app — their numbers get wired to source data next. Season filtering is scaffolded pending
        per-season source ingestion.
      </p>
    </main>
  );
}

function Section({
  title,
  href,
  tiles,
  sample = false,
}: {
  title: string;
  href?: string;
  tiles: Tile[];
  sample?: boolean;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h2 className="text-lg font-semibold" style={{ color: "var(--glass-text)" }}>{title}</h2>
          {sample && (
            <span className="text-[9px] uppercase tracking-[0.16em] font-bold px-1.5 py-0.5 rounded"
              style={{ background: "var(--glass-surface-hover)", color: "var(--glass-text-tertiary)" }}>
              sample
            </span>
          )}
        </div>
        {href && (
          <a href={href} target="_blank" rel="noopener noreferrer"
            className="text-xs font-semibold shrink-0 hover:brightness-110 transition" style={{ color: "var(--glass-gold)" }}>
            More details →
          </a>
        )}
      </div>
      {tiles.length ? (
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {tiles.map((t, i) => <StatTile key={i} {...t} />)}
        </div>
      ) : (
        <div className="rounded-xl border border-glass-border bg-glass-surface px-4 py-6 text-sm italic text-glass-text-tertiary">
          Cards coming soon — open the app for the full view.
        </div>
      )}
    </section>
  );
}

function StatTile({ label, value, unit, sub, lines, tone = "default", link }: Tile) {
  const color =
    tone === "ok" ? "rgb(74,222,128)" :
    tone === "warn" ? "var(--glass-gold)" :
    tone === "bad" ? "rgb(248,113,113)" : "var(--glass-text)";
  return (
    <div className="rounded-xl border border-glass-border bg-glass-surface px-4 py-3.5 min-w-0">
      <div className="text-[10px] uppercase tracking-[0.16em] font-bold text-glass-text-tertiary truncate">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className="text-2xl font-bold tabular" style={{ color }}>{value}</span>
        {unit && <span className="text-sm text-glass-text-tertiary">{unit}</span>}
      </div>
      {sub && <div className="text-[11px] text-glass-text-tertiary mt-1 leading-snug">{sub}</div>}
      {lines && lines.length > 0 && (
        <div className="mt-2 space-y-0.5 tabular">
          {lines.map((l, i) => (
            <div
              key={i}
              className="text-xs leading-snug"
              style={{ color: l.strong ? "var(--glass-text)" : "var(--glass-text-tertiary)", fontWeight: l.strong ? 600 : 400 }}
            >
              {l.text}
            </div>
          ))}
        </div>
      )}
      {link && (
        <a href={link.href} target="_blank" rel="noopener noreferrer"
          className="inline-block mt-2.5 text-xs font-semibold hover:brightness-110 transition" style={{ color: "var(--glass-gold)" }}>
          {link.label}
        </a>
      )}
    </div>
  );
}
