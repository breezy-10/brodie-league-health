import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { sourceClient, sourceConfigured } from "@/lib/source-apps/clients";
import { resolveLocationsForLM, resolveLocationIdsByName } from "@/lib/source-apps/cross-app-locations";
import type { AppSlug } from "@/lib/source-apps/clients";
import { ymd } from "@/lib/source-apps/util";
import type { SupabaseClient } from "@supabase/supabase-js";
import Filters, { type FilterOptions } from "./Filters";

// Fallbacks copied from the Registration Promo Tracker, used until the live
// PROMO_SUPABASE_* connection is configured (then these are replaced live).
const PROMO_LOCATIONS_FALLBACK = [
  "Boston", "Brampton", "Brooklyn - Bushwick", "Brooklyn - Greenpoint", "Burlington",
  "Calgary", "Chicago", "Edmonton", "Kitchener", "London", "Markham", "Milton",
  "Mississauga", "Montreal", "Niagara", "Oakville", "Oshawa", "Ottawa", "Scarborough",
  "Toronto (Downtown)", "Toronto (Hoopdome)", "Vancouver", "Vaughan", "Winnipeg",
];
const PROMO_SEASONS_FALLBACK = ["Fall '26", "Summer '26"];

// Promo Tracker location name -> League Health league_managers.location_name,
// so selecting a location still matches the roster in the live sections.
const PROMO_TO_ROSTER: Record<string, string> = {
  "Brampton": "Brampton (Game6)",
  "Brooklyn - Bushwick": "Brooklyn (Bushwick)",
};

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

// ---------------------------------------------------------------------------
// Read-through reporting layer. Each loader queries its source app directly,
// scoped to the selected season via the source's own season_id, and returns
// card tiles (or null when the source isn't wired -> caller uses the sample).
// ---------------------------------------------------------------------------

// Normalize a season label to term+2-digit-year: "Fall '26" / "Fall 2026" -> "fall26".
function seasonKey(name: string): string {
  const term = name.toLowerCase().match(/fall|summer|winter|spring/)?.[0] ?? "";
  const yr = (name.match(/\d{2,4}/)?.[0] ?? "").slice(-2);
  return `${term}${yr}`;
}

// The registration/promo push runs one season ahead of play:
// "Summer '26" -> "Fall '26", "Fall '26" -> "Winter '27".
const SEASON_TERMS = ["winter", "spring", "summer", "fall"];
function nextSeasonLabel(season: string): string {
  const term = season.toLowerCase().match(/winter|spring|summer|fall/)?.[0];
  const yy = parseInt((season.match(/\d{2,4}/)?.[0] ?? "").slice(-2), 10);
  if (!term || Number.isNaN(yy)) return season;
  const i = SEASON_TERMS.indexOf(term);
  const nextTerm = SEASON_TERMS[(i + 1) % 4];
  const nextYy = i === 3 ? yy + 1 : yy;
  return `${nextTerm[0].toUpperCase()}${nextTerm.slice(1)} '${String(nextYy).padStart(2, "0")}`;
}

// Resolve the selected global season to a source's own season_id(s) via its
// `seasons` table (matched on name term+year). Consistent across every source.
async function resolveSeasonIds(sb: SupabaseClient, season: string): Promise<string[]> {
  const { data } = await sb.from("seasons").select("id, name");
  const want = seasonKey(season);
  return ((data ?? []) as { id: string; name: string | null }[])
    .filter((s) => s.name && seasonKey(s.name) === want)
    .map((s) => s.id);
}

const pctTone = (p: number): Tone => (p >= 70 ? "ok" : p >= 40 ? "warn" : "bad");

type Scope = { lm: string; location: string; lmEmail?: string };

// Resolve the active Location/LM filter to this source's own location_id(s).
// null = no location filter (show all); [] = filter matches no location here.
async function sourceLocationIds(
  appSlug: Exclude<AppSlug, "facilities" | "crm">,
  scope: Scope,
): Promise<string[] | null> {
  if (scope.lm !== "all") return scope.lmEmail ? resolveLocationsForLM(appSlug, scope.lmEmail) : [];
  if (scope.location !== "all") return resolveLocationIdsByName(appSlug, scope.location);
  return null;
}

// Fetch rows from a source table filtered by season_id and (optionally)
// location_id, returning [] when either filter excludes everything.
async function fetchScoped(
  sb: SupabaseClient, table: string, cols: string, seasonIds: string[], locIds: string[] | null,
): Promise<Record<string, unknown>[]> {
  if (!seasonIds.length || (locIds && locIds.length === 0)) return [];
  let q = sb.from(table).select(cols).in("season_id", seasonIds);
  if (locIds) q = q.in("location_id", locIds);
  const { data } = await q;
  return (data ?? []) as unknown as Record<string, unknown>[];
}

async function loadChecklistTiles(season: string, scope: Scope): Promise<Tile[] | null> {
  if (!sourceConfigured("checklist")) return null;
  const sb = sourceClient("checklist")!;
  const locIds = await sourceLocationIds("checklist", scope);
  const locSet = locIds ? new Set(locIds) : null;
  // Checklist location lives on `seasons.location_id`, not on the tasks.
  const { data: seasons } = await sb.from("seasons").select("id, name, location_id");
  const want = seasonKey(season);
  const ids = ((seasons ?? []) as { id: string; name: string | null; location_id: string | null }[])
    .filter((s) => s.name && seasonKey(s.name) === want && (!locSet || (s.location_id != null && locSet.has(s.location_id))))
    .map((s) => s.id);
  const { data } = ids.length
    ? await sb.from("season_tasks").select("status, due_date").in("season_id", ids)
    : { data: [] as { status: string; due_date: string | null }[] };
  const list = (data ?? []) as { status: string; due_date: string | null }[];
  const total = list.length;
  const done = list.filter((t) => t.status === "done").length;
  const today = ymd(new Date());
  const overdue = list.filter((t) => t.due_date && t.due_date < today && t.status === "not_started").length;
  const pct = total ? Math.round((100 * done) / total) : 0;
  return [
    { label: `Tasks complete · ${season}`, value: `${pct}%`, sub: `${done.toLocaleString()} / ${total.toLocaleString()}`, tone: pctTone(pct) },
    { label: `Overdue tasks · ${season}`, value: overdue.toLocaleString(), sub: "not started, past due", tone: overdue > 0 ? "bad" : "ok" },
  ];
}

async function loadFeedbackTiles(season: string, scope: Scope): Promise<Tile[] | null> {
  if (!sourceConfigured("feedback")) return null;
  const sb = sourceClient("feedback")!;
  const [ids, locIds] = await Promise.all([resolveSeasonIds(sb, season), sourceLocationIds("feedback", scope)]);
  const r = (await fetchScoped(sb, "responses", "nps_score, composite_csat, retention_intent", ids, locIds)) as unknown as { nps_score: number | null; composite_csat: number | null; retention_intent: string | null }[];
  const nps = r.filter((x): x is { nps_score: number; composite_csat: number | null; retention_intent: string | null } => x.nps_score != null);
  const prom = nps.filter((x) => x.nps_score >= 9).length;
  const det = nps.filter((x) => x.nps_score <= 6).length;
  const npsScore = nps.length ? Math.round((100 * (prom - det)) / nps.length) : 0;
  const csat = r.filter((x): x is { nps_score: number | null; composite_csat: number; retention_intent: string | null } => x.composite_csat != null);
  const good = csat.filter((x) => x.composite_csat >= 8).length;
  const csatPct = csat.length ? Math.round((100 * good) / csat.length) : 0;
  const yes = r.filter((x) => x.retention_intent === "Yes").length;
  const thinking = r.filter((x) => x.retention_intent === "Thinking about it").length;
  const no = r.filter((x) => x.retention_intent === "No").length;
  const retTot = yes + thinking + no;
  const retPct = retTot ? Math.round((100 * yes) / retTot) : 0;
  return [
    { label: "Responses", value: r.length.toLocaleString() },
    { label: "CSAT", value: `${csatPct}%`, sub: `${good} of ${csat.length} rated 8 or higher`, tone: pctTone(csatPct) },
    { label: "NPS", value: `${npsScore}`, sub: `${nps.length ? Math.round((100 * prom) / nps.length) : 0}% promoters (${prom}) · ${nps.length ? Math.round((100 * det) / nps.length) : 0}% detractors (${det}) of ${nps.length} scored`, tone: npsScore >= 30 ? "ok" : npsScore >= 0 ? "warn" : "bad" },
    { label: "Returning intent", value: `${retPct}%`, sub: `${yes.toLocaleString()} yes · ${thinking.toLocaleString()} thinking · ${no.toLocaleString()} no` },
  ];
}

async function loadContentTiles(season: string, scope: Scope): Promise<Tile[] | null> {
  if (!sourceConfigured("content_health")) return null;
  const sb = sourceClient("content_health")!;
  const [ids, locIds] = await Promise.all([resolveSeasonIds(sb, season), sourceLocationIds("content_health", scope)]);
  const cn = (await fetchScoped(sb, "content_nights", "iphone_clips_posted_at, photos_posted_at, videos_posted_at", ids, locIds)) as unknown as { iphone_clips_posted_at: string | null; photos_posted_at: string | null; videos_posted_at: string | null }[];
  const nights = cn.length;
  const mk = (label: string, n: number): Tile => {
    const pct = nights ? Math.round((100 * n) / nights) : 0;
    return { label, value: `${n}`, unit: `/ ${nights}`, sub: `${pct}%`, tone: pctTone(pct) };
  };
  return [
    { label: "Content nights", value: nights.toLocaleString() },
    mk("Clips posted", cn.filter((x) => x.iphone_clips_posted_at).length),
    mk("Photos posted", cn.filter((x) => x.photos_posted_at).length),
    mk("Videos posted", cn.filter((x) => x.videos_posted_at).length),
  ];
}

async function loadStatsTiles(season: string, scope: Scope): Promise<Tile[] | null> {
  if (!sourceConfigured("stats_health")) return null;
  const sb = sourceClient("stats_health")!;
  const [ids, locIds] = await Promise.all([resolveSeasonIds(sb, season), sourceLocationIds("stats_health", scope)]);
  const g = (await fetchScoped(sb, "games", "stats_source, stats_completed, stream_status, platform_spare_count", ids, locIds)) as unknown as { stats_source: string | null; stats_completed: boolean | null; stream_status: string | null; platform_spare_count: number | null }[];
  const played = g.filter((x) => x.stats_completed != null);
  const completed = played.filter((x) => x.stats_completed === true).length;
  const compPct = played.length ? Math.round((100 * completed) / played.length) : 0;
  const src = (s: string) => g.filter((x) => x.stats_source === s).length;
  const resolved = g.filter((x) => x.stream_status && x.stream_status !== "pending");
  const full = resolved.filter((x) => x.stream_status === "clean").length;
  const incomplete = resolved.length - full;
  const fullPct = resolved.length ? Math.round((100 * full) / resolved.length) : 0;
  const spareGames = g.filter((x) => (x.platform_spare_count ?? 0) > 0).length;
  const spareTotal = g.reduce((a, x) => a + (x.platform_spare_count ?? 0), 0);
  return [
    {
      label: "Stats completion rate", value: `${compPct}%`, tone: pctTone(compPct),
      lines: [
        { text: `${played.length.toLocaleString()} — games played`, strong: true },
        { text: `${g.length.toLocaleString()} — games tracked`, strong: true },
        { text: `${src("ballertv").toLocaleString()} — BallerTV` },
        { text: `${src("livebarn").toLocaleString()} — LiveBarn` },
        { text: `${src("scoresheet").toLocaleString()} — Scoresheet` },
        { text: `${(played.length - completed).toLocaleString()} — No stats` },
      ],
    },
    {
      label: "Full recording %", value: `${fullPct}%`, tone: pctTone(fullPct),
      lines: [
        { text: `${full.toLocaleString()} — full` },
        { text: `${incomplete.toLocaleString()} — incomplete` },
        { text: `${resolved.length.toLocaleString()} — total` },
      ],
    },
    {
      label: "Spare players", value: spareTotal.toLocaleString(), tone: "warn",
      lines: [
        { text: `${spareGames.toLocaleString()} — games with spares` },
        { text: `${spareTotal.toLocaleString()} — spare appearances` },
      ],
      link: { href: "https://brodie-stats-health.vercel.app", label: "See games with spares →" },
    },
  ];
}

async function loadPromoTiles(season: string, scope: Scope): Promise<Tile[] | null> {
  if (!sourceConfigured("promo")) return null;
  const sb = sourceClient("promo")!;
  const [ids, locIds] = await Promise.all([resolveSeasonIds(sb, season), sourceLocationIds("promo", scope)]);
  const regs = await fetchScoped(sb, "registrations_cache", "id", ids, locIds);
  const regIds = regs.map((r) => r.id as string);
  const teams = regIds.length;
  let stories = 0, highlights = 0;
  if (regIds.length) {
    const { data: ps } = await sb.from("promo_states").select("team_locked_story_posted, highlight_posted").in("registration_id", regIds);
    const list = (ps ?? []) as { team_locked_story_posted: boolean | null; highlight_posted: boolean | null }[];
    stories = list.filter((x) => x.team_locked_story_posted).length;
    highlights = list.filter((x) => x.highlight_posted).length;
  }
  const sPct = teams ? Math.round((100 * stories) / teams) : 0;
  const hPct = teams ? Math.round((100 * highlights) / teams) : 0;
  return [
    { label: "Teams registered", value: teams.toLocaleString() },
    { label: "Stories posted", value: `${stories}`, unit: `/ ${teams}`, sub: `${sPct}%`, tone: pctTone(sPct) },
    { label: "Highlights posted", value: `${highlights}`, unit: `/ ${teams}`, sub: `${hPct}%`, tone: pctTone(hPct) },
  ];
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; location?: string; lm?: string }>;
}) {
  await requireRole(["dm", "super_admin"]);
  const { season: seasonParam, location = "all", lm = "all" } = await searchParams;
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
    .select("id, full_name, email, location_name")
    .eq("active", true)
    .order("full_name");
  const activeLMs = (lmsRaw ?? []) as { id: string; full_name: string | null; email: string; location_name: string | null }[];

  // Locations + seasons from the Registration Promo Tracker — live when the
  // PROMO_SUPABASE_* connection is wired, otherwise the copied fallbacks.
  let promoLocations = PROMO_LOCATIONS_FALLBACK;
  let promoSeasons = PROMO_SEASONS_FALLBACK;
  let currentSeason: string | undefined;
  if (sourceConfigured("promo")) {
    const promo = sourceClient("promo")!;
    const [locRes, seaRes] = await Promise.all([
      promo.from("locations").select("name, sort_order").order("sort_order"),
      promo.from("seasons").select("name, is_current").order("is_current", { ascending: false }),
    ]);
    const locNames = ((locRes.data ?? []) as { name: string | null }[]).map((l) => l.name).filter((n): n is string => !!n);
    if (locNames.length) promoLocations = locNames;
    const seaRows = (seaRes.data ?? []) as { name: string | null; is_current: boolean | null }[];
    const seaNames = seaRows.map((s) => s.name).filter((n): n is string => !!n);
    if (seaNames.length) promoSeasons = seaNames;
    currentSeason = seaRows.find((s) => s.is_current)?.name ?? undefined;
  }
  // Default to the active PLAYING season (today within its date range, per the
  // stats source) rather than the promo's registration season — that's where
  // the games/feedback/content/checklist data actually lives right now.
  let activeSeasonLabel: string | undefined;
  if (sourceConfigured("stats_health")) {
    const st = sourceClient("stats_health")!;
    const today = ymd(new Date());
    const { data } = await st.from("seasons").select("name, start_date, end_date");
    const active = ((data ?? []) as { name: string | null; start_date: string | null; end_date: string | null }[])
      .find((s) => s.start_date && s.end_date && s.start_date <= today && today <= s.end_date);
    if (active?.name) activeSeasonLabel = promoSeasons.find((s) => seasonKey(s) === seasonKey(active.name!)) ?? active.name;
  }
  const selectedSeason = seasonParam || activeSeasonLabel || currentSeason || promoSeasons[0] || "current";

  // Registration + promo work runs one season ahead of the playing season.
  const regSeason = nextSeasonLabel(selectedSeason);

  // Live, season + location/LM scoped section cards (fall back to sample if unwired).
  const scope: Scope = {
    lm,
    location,
    lmEmail: lm !== "all" ? activeLMs.find((l) => l.id === lm)?.email : undefined,
  };
  const [ckCurrent, ckNext, feedbackTiles, statsTiles, contentTiles, promoTiles] = await Promise.all([
    loadChecklistTiles(selectedSeason, scope),
    loadChecklistTiles(regSeason, scope),
    loadFeedbackTiles(selectedSeason, scope),
    loadStatsTiles(selectedSeason, scope),
    loadContentTiles(selectedSeason, scope),
    loadPromoTiles(regSeason, scope),
  ]);
  // Checklist: two cards for the playing season, two for the next (prep) season.
  const checklistTiles = ckCurrent && ckNext ? [...ckCurrent, ...ckNext] : (ckCurrent ?? null);

  const snaps: SnapRow[] = snapDate
    ? (((await admin
        .from("daily_snapshots")
        .select("raw_value, lm_id, metrics!inner(name, slug), apps!inner(slug, name), league_managers!inner(id, full_name, location_name, active)")
        .eq("snapshot_date", snapDate)
      ).data) as unknown as SnapRow[]) ?? []
    : [];

  // Map the selected Promo Tracker location to its roster name for matching.
  const rosterLocation = location !== "all" ? (PROMO_TO_ROSTER[location] ?? location) : "all";
  const filtered = snaps.filter((s) => {
    if (!s.league_managers?.active) return false;
    if (rosterLocation !== "all" && s.league_managers.location_name !== rosterLocation) return false;
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
    seasons: promoSeasons.map((s) => ({ value: s, label: s })),
    locations: promoLocations,
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

      <Filters key={`${selectedSeason}|${location}|${lm}`} options={options} current={{ season: selectedSeason, location, lm }} />

      <div className="space-y-8">
        <Section title="Season Success Checklist" href={APP_URL.checklist} tiles={checklistTiles ?? SAMPLE.checklist} sample={!checklistTiles} />
        <Section title="Registrations" href={APP_URL.crm} tiles={realTiles("crm")} seasonTag={regSeason} />
        <Section title="Registration Promo Tracker" href={APP_URL.promo} tiles={promoTiles ?? SAMPLE.promo} sample={!promoTiles} seasonTag={regSeason} />
        <Section title="Feedback" href={APP_URL.feedback} tiles={feedbackTiles ?? SAMPLE.feedback} sample={!feedbackTiles} />
        <Section title="Stats Health" href={APP_URL.stats_health} tiles={statsTiles ?? SAMPLE.stats_health} sample={!statsTiles} />
        <Section title="Content Health" href={APP_URL.content_health} tiles={contentTiles ?? realTiles("content_health")} />
        <Section title="Overdue Payments" href={APP_URL.overdue} tiles={[]} sample />
      </div>

      <p className="text-xs text-glass-text-tertiary">
        Feedback, Stats Health, and Content Health read live from each source, scoped to the selected Season, Location,
        and League manager (locations reconciled across apps by fuzzy match). Registration + Promo run one season ahead
        (the prep season, tagged in gold), and the Checklist shows both. The Promo Tracker joins once its key is added.
      </p>
    </main>
  );
}

function Section({
  title,
  href,
  tiles,
  sample = false,
  seasonTag,
}: {
  title: string;
  href?: string;
  tiles: Tile[];
  sample?: boolean;
  seasonTag?: string;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h2 className="text-lg font-semibold" style={{ color: "var(--glass-text)" }}>{title}</h2>
          {seasonTag && (
            <span className="text-[9px] uppercase tracking-[0.16em] font-bold px-1.5 py-0.5 rounded"
              style={{ background: "var(--glass-gold-light, rgba(255,184,0,0.16))", color: "var(--glass-gold)" }}>
              {seasonTag}
            </span>
          )}
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
