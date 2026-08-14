import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { sourceClient, sourceConfigured } from "@/lib/source-apps/clients";
import { resolveLocationsForLM, resolveLocationIdsByName } from "@/lib/source-apps/cross-app-locations";
import type { AppSlug } from "@/lib/source-apps/clients";
import { ymd } from "@/lib/source-apps/util";
import { loadActiveLMs, locParam, resolveScope, seasonKey, shortSeason } from "@/lib/seasons";
import Filters, { type FilterOptions } from "./Filters";

// Promo Tracker location name -> League Health league_managers.location_name,
// so selecting a location still matches the roster in the live sections.
const PROMO_TO_ROSTER: Record<string, string> = {
  "Brampton": "Brampton (Game6)",
  "Brooklyn - Bushwick": "Brooklyn (Bushwick)",
};

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
  overdue: [
    { label: "Total overdue players", value: "144", sub: "across 19 locations", tone: "bad" },
    { label: "Overdue Balance - Canadian Locations", value: "$20,799.32 CAD", sub: "80 players" },
    { label: "Overdue Balance - US Locations", value: "$13,184.17 USD", sub: "64 players" },
  ],
  content: [
    { label: "iPhone Clips · 12h", value: "22.0", unit: "/hr", sub: "target 20/hr", tone: "ok", lines: [{ text: "24,632 clips delivered · 1,118.5h worked", strong: true }, { text: "110% of expected · SLA hit 36%" }] },
    { label: "Photos · 3 days", value: "74.5", unit: "/hr", sub: "target 90/hr", tone: "bad", lines: [{ text: "99,101 photos delivered · 1,331.0h worked", strong: true }, { text: "83% of expected · SLA hit 25%" }] },
    { label: "Canto - players tagged", value: "673", unit: "/ 736", sub: "91% complete", tone: "ok", lines: [{ text: "673 this season · 0 past season" }] },
    { label: "App profiles", value: "641", unit: "/ 736", sub: "87% complete", tone: "ok", lines: [{ text: "577 current team · 64 previous team" }] },
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

// Green >= 90%, yellow 70-89%, red < 70%.
const pctTone = (p: number): Tone => (p >= 90 ? "ok" : p >= 70 ? "warn" : "bad");

// locationNames = the resolved list of location names this view is scoped to
// (from the LM's district coverage, or a single selected location). null = all;
// [] = the filter resolves to no location.
type Scope = { lm: string; location: string; locationNames: string[] | null };

// Resolve the scoped location names to this source's own location_id(s).
// null = no location filter (show all); [] = filter matches no location here.
async function sourceLocationIds(
  appSlug: Exclude<AppSlug, "facilities" | "crm">,
  scope: Scope,
): Promise<string[] | null> {
  if (!scope.locationNames) return null;
  if (!scope.locationNames.length) return [];
  const arrs = await Promise.all(scope.locationNames.map((n) => resolveLocationIdsByName(appSlug, n)));
  return [...new Set(arrs.flat())];
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
    { label: `Tasks complete · ${season}`, value: `${pct}%`, sub: `${done.toLocaleString()} / ${total.toLocaleString()}`, tone: pct >= 100 ? "ok" : pct > 0 ? "warn" : "bad" },
    { label: `Overdue tasks · ${season}`, value: overdue.toLocaleString(), sub: "not started, past due", tone: overdue > 0 ? "bad" : "ok" },
  ];
}

// Feedback reads the feedback app's OWN KPI feed (response_summary RPC), so the
// numbers match its site exactly — correct season (survey.intended_season_id)
// and pagination included. Returns null on failure -> sample.
async function loadFeedbackTiles(season: string, scope: Scope): Promise<Tile[] | null> {
  try {
    const url = new URL("/api/dashboard-kpis", "https://brodie-feedback.vercel.app");
    url.searchParams.set("season", season);
    const lp = locParam(scope.locationNames); if (lp) url.searchParams.set("location", lp);
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as {
      responses: number; csat_pct: number | null; csat_tone: Tone; csat_satisfied: number; csat_total: number;
      nps: number | null; nps_tone: Tone; promoters: number; detractors: number; nps_total: number;
      promoter_pct: number | null; detractor_pct: number | null;
      retention_pct: number | null; retention_yes: number; retention_thinking: number; retention_no: number;
    };
    // Tones come from the feedback site's own colour functions (csatColor/npsColor);
    // Returning intent is left uncoloured, matching that site.
    return [
      { label: "Responses", value: k.responses.toLocaleString() },
      { label: "CSAT", value: k.csat_pct == null ? "—" : `${k.csat_pct}%`, sub: k.csat_pct == null ? "no CSAT question" : `${k.csat_satisfied} of ${k.csat_total} rated 8 or higher`, tone: k.csat_tone ?? "default" },
      { label: "NPS", value: k.nps == null ? "—" : `${k.nps}`, sub: k.nps == null ? "no NPS scored" : `${k.promoter_pct}% promoters (${k.promoters}) · ${k.detractor_pct}% detractors (${k.detractors}) of ${k.nps_total} scored`, tone: k.nps_tone ?? "default" },
      { label: "Returning intent", value: k.retention_pct == null ? "—" : `${k.retention_pct}%`, sub: k.retention_pct == null ? "no retention question" : `${k.retention_yes} yes · ${k.retention_thinking} thinking · ${k.retention_no} no` },
    ];
  } catch {
    return null;
  }
}

// Content Health reads the app's OWN KPI feed (SLA + expected-delivery math),
// so the iPhone Clips + Photos cards match its site exactly. Null -> sample.
type ContentCard = { delivered: number; hours_worked: number; rate: number | null; target: number; expected_pct: number | null; sla_pct: number | null };
function contentTile(label: string, unit: string, c: ContentCard): Tile {
  const hrs = c.hours_worked.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return {
    label, value: c.rate == null ? "—" : c.rate.toFixed(1), unit: "/hr",
    sub: `target ${c.target}/hr`,
    tone: c.rate == null ? "default" : c.rate >= c.target ? "ok" : "bad",
    lines: [
      { text: `${c.delivered.toLocaleString()} ${unit} delivered · ${hrs}h worked`, strong: true },
      { text: `${c.expected_pct == null ? "—" : `${c.expected_pct}%`} of expected · SLA hit ${c.sla_pct == null ? "—" : `${c.sla_pct}%`}` },
    ],
  };
}
async function loadContentTiles(season: string, scope: Scope): Promise<Tile[] | null> {
  try {
    const url = new URL("/api/dashboard-kpis", "https://brodie-content-health.vercel.app");
    url.searchParams.set("season", season);
    const lp = locParam(scope.locationNames); if (lp) url.searchParams.set("location", lp);
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as {
      clips: ContentCard; photos: ContentCard;
      canto?: RosterCard; app?: RosterCard;
    };
    const tiles = [contentTile("iPhone Clips · 12h", "clips", k.clips), contentTile("Photos · 3 days", "photos", k.photos)];
    if (k.canto) tiles.push(rosterTile("Canto - players tagged", k.canto, `${k.canto.this_season} this season · ${k.canto.past_season} past season`));
    if (k.app) tiles.push(rosterTile("App profiles", k.app, `${k.app.current_team} current team · ${k.app.previous_team} previous team`));
    return tiles;
  } catch {
    return null;
  }
}

type RosterCard = { done: number; total: number; pct: number; this_season: number; past_season: number; current_team: number; previous_team: number };
function rosterTile(label: string, c: RosterCard, split: string): Tile {
  return {
    label, value: c.done.toLocaleString(), unit: `/ ${c.total.toLocaleString()}`,
    sub: `${c.pct}% complete`, tone: c.total === 0 ? "default" : pctTone(c.pct),
    lines: [{ text: split }],
  };
}

// Stats Health: the direct query hit the Supabase 1000-row cap and used a
// different tracked/played definition than the Stats Health site (which pulls
// "games played" from an external API and windows games from 2026-05-04). Until
// we read from that app's own KPI feed (like Feedback / Promo / Overdue), fall
// back to the sample card rather than show wrong live numbers.
// Stats Health reads the app's OWN KPI feed (same paginated card math +
// scheduledPlayedCount), so the numbers match its site exactly. Null -> sample.
async function loadStatsTiles(season: string, scope: Scope): Promise<Tile[] | null> {
  try {
    const url = new URL("/api/dashboard-kpis", "https://brodie-stats-health.vercel.app");
    url.searchParams.set("season", season);
    const lp = locParam(scope.locationNames); if (lp) url.searchParams.set("location", lp);
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as {
      stats_completion_pct: number | null; stats_completion_tone?: Tone; full_recording_tone?: Tone; games_played: number | null; games_tracked: number;
      by_source: { ballertv: number; livebarn: number; scoresheet: number }; no_stats: number;
      full_recording_pct: number | null; full: number; incomplete: number; recording_total: number;
      spare_appearances: number; spare_games: number;
    };
    const n = (x: number) => x.toLocaleString();
    const completionLines: { text: string; strong?: boolean }[] = [];
    // Only show "games played" (external schedule count) when it's sane — it must
    // be >= tracked, since every tracked game was played.
    if (k.games_played != null && k.games_played >= k.games_tracked) {
      completionLines.push({ text: `${n(k.games_played)} — games played`, strong: true });
    }
    completionLines.push({ text: `${n(k.games_tracked)} — games tracked`, strong: true });
    completionLines.push({ text: `${n(k.by_source.ballertv)} — BallerTV` });
    completionLines.push({ text: `${n(k.by_source.livebarn)} — LiveBarn` });
    completionLines.push({ text: `${n(k.by_source.scoresheet)} — In-venue` });
    completionLines.push({ text: `${n(k.no_stats)} — No stats` });
    return [
      {
        label: "Stats completion rate", value: k.stats_completion_pct == null ? "—" : `${k.stats_completion_pct}%`,
        tone: k.stats_completion_tone ?? (k.stats_completion_pct == null ? "default" : pctTone(k.stats_completion_pct)),
        lines: completionLines,
      },
      {
        label: "Full recording %", value: k.full_recording_pct == null ? "—" : `${k.full_recording_pct}%`,
        tone: k.full_recording_tone ?? (k.full_recording_pct == null ? "default" : pctTone(k.full_recording_pct)),
        lines: [
          { text: `${n(k.full)} — full` },
          { text: `${n(k.incomplete)} — incomplete` },
          { text: `${n(k.recording_total)} — total` },
        ],
      },
      {
        label: "Spare players", value: n(k.spare_appearances), tone: k.spare_appearances > 0 ? "warn" : "default",
        lines: [
          { text: `${n(k.spare_games)} — games with spares` },
          { text: `${n(k.spare_appearances)} — spare appearances` },
        ],
        link: { href: "https://brodie-stats-health.vercel.app", label: "See games with spares →" },
      },
    ];
  } catch {
    return null;
  }
}

// Overdue Payments reads that app's OWN public KPI feed. When a location is
// selected only its currency has players, so only that currency card renders.
// Overdue reads the app's OWN checkin-stats feed (season-scoped), which computes
// the "active" = checked-in breakdown (owed by players who played a completed
// game that season). Amount-first currency labels; a location selected shows
// only that location's currency (the other has no players).
type CurTotals = { total_players: number; total_balance: number; active_players: number; active_balance: number; bad_debt: number };
async function loadOverdueTiles(season: string, scope: Scope): Promise<Tile[] | null> {
  try {
    const url = new URL("/api/checkin-stats", "https://brodie-overdue-payments.vercel.app");
    url.searchParams.set("season", season);
    const lp = locParam(scope.locationNames); if (lp) url.searchParams.set("location", lp);
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as {
      currency_totals?: { cad: CurTotals; usd: CurTotals };
      overall?: { total_players: number; active_players: number; locations: number };
    };
    if (!k.currency_totals || !k.overall) return null; // pre-deploy shape -> sample
    const ov = k.overall;
    const money = (n: number, cur: string) =>
      `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
    const tiles: Tile[] = [
      {
        label: "Total overdue players", value: ov.total_players.toLocaleString(), tone: ov.total_players > 0 ? "bad" : "ok",
        lines: [
          { text: `${ov.active_players.toLocaleString()} of ${ov.total_players.toLocaleString()} active`, strong: true },
          { text: `across ${ov.locations} location${ov.locations === 1 ? "" : "s"}` },
        ],
      },
    ];
    const card = (c: CurTotals, cur: string, label: string): Tile | null =>
      c.total_players === 0 ? null : {
        label, value: money(c.total_balance, cur),
        lines: [
          { text: `${c.total_players} player${c.total_players === 1 ? "" : "s"}`, strong: true },
          { text: `${money(c.active_balance, cur)} from active players` },
          { text: `${c.active_players} of ${c.total_players} players active` },
        ],
      };
    const cad = card(k.currency_totals.cad, "CAD", "Overdue Balance - Canadian Locations");
    const usd = card(k.currency_totals.usd, "USD", "Overdue Balance - US Locations");
    if (cad) tiles.push(cad);
    if (usd) tiles.push(usd);
    return tiles;
  } catch {
    return null;
  }
}

// Promo reads the Promo Tracker's OWN public KPI feed, so the numbers match its
// website exactly (no re-derivation here). Returns null on any failure -> sample.
async function loadPromoTiles(season: string, scope: Scope): Promise<Tile[] | null> {
  try {
    const url = new URL("/api/dashboard-kpis", "https://registration-promo-tracker.vercel.app");
    url.searchParams.set("season", season);
    const lp = locParam(scope.locationNames); if (lp) url.searchParams.set("location", lp);
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (res.status === 404) {
      // Season is beyond the promo horizon — registration hasn't opened.
      return [
        { label: "Teams registered", value: "0", sub: `${season} — registration not open yet` },
        { label: "Stories posted", value: "0", unit: "/ 0", sub: "0%" },
        { label: "Highlights posted", value: "0", unit: "/ 0", sub: "0%" },
        { label: "Avg time to post", value: "—", sub: "0 posts" },
      ];
    }
    if (!res.ok) return null;
    const k = (await res.json()) as {
      teams_registered: number; stories_posted: number; highlights_posted: number;
      story_pct: number; highlight_pct: number; story_tone?: Tone; highlight_tone?: Tone; avg_time_to_post_ms: number | null;
      avg_time_to_post_sample: number; locations: number;
    };
    const fmt = (ms: number) => {
      const m = Math.floor(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
      return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${mm}m` : `${mm}m`;
    };
    return [
      { label: "Teams registered", value: k.teams_registered.toLocaleString(), sub: `across ${k.locations} locations` },
      { label: "Stories posted", value: `${k.stories_posted}`, unit: `/ ${k.teams_registered}`, sub: `${k.story_pct}%`, tone: k.story_tone ?? pctTone(k.story_pct) },
      { label: "Highlights posted", value: `${k.highlights_posted}`, unit: `/ ${k.teams_registered}`, sub: `${k.highlight_pct}%`, tone: k.highlight_tone ?? pctTone(k.highlight_pct) },
      { label: "Avg time to post", value: k.avg_time_to_post_ms != null ? fmt(k.avg_time_to_post_ms) : "—", sub: `${k.avg_time_to_post_sample} posts`, tone: "warn" },
    ];
  } catch {
    return null;
  }
}

// Registration pacing (teams + athletes at "day N of registration" for this
// season vs the previous season vs a year ago) from the Promo Tracker feed.
type PacingSeason = { season: string; kind: string; captains: number; athletes: number };
type Retention = { pct: number; prev_athletes: number; retained: number; prev_season: string };
type PacingLocation = { location: string; seasons: PacingSeason[]; retention?: Retention | null };
type Pacing = { day_n: number | null; seasons: PacingSeason[]; locations?: PacingLocation[] };
async function loadRegistrationPacing(regSeason: string, scope: Scope): Promise<Pacing | null> {
  try {
    const url = new URL("/api/registration-pacing", "https://registration-promo-tracker.vercel.app");
    url.searchParams.set("season", regSeason);
    url.searchParams.set("breakdown", "location");
    const lp = locParam(scope.locationNames); if (lp) url.searchParams.set("location", lp);
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const k = (await res.json()) as Pacing;
    return k.seasons?.length ? k : null;
  } catch {
    return null;
  }
}

const KIND_LABEL: Record<string, string> = { current: "this season", prev_season: "prev season", prev_year: "last year" };
const REG_COLOR: Record<string, string> = { current: "var(--glass-gold)", prev_season: "#5B8AC4", prev_year: "#A874C9" };
const TRACK_PX = 130;
function RegBarCard({ title, subtitle, current, bars }: {
  title: string; subtitle: string; current: number;
  bars: { label: string; sub: string; value: number; color: string }[];
}) {
  const max = Math.max(...bars.map((b) => b.value), 1);
  return (
    <div className="rounded-2xl border border-glass-border bg-glass-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold" style={{ color: "var(--glass-text)" }}>{title}</h3>
          <p className="text-xs mt-0.5 text-glass-text-tertiary">{subtitle}</p>
        </div>
        <span className="text-2xl font-bold tabular" style={{ color: "var(--glass-gold)" }}>{current.toLocaleString()}</span>
      </div>
      {/* Bars: fixed-px track so heights are truly proportional to value. */}
      <div className="flex items-end gap-6 mt-5" style={{ height: TRACK_PX + 22 }}>
        {bars.map((b, i) => (
          <div key={i} className="flex-1 flex flex-col items-center justify-end">
            <span className="text-sm font-semibold mb-1" style={{ color: "var(--glass-text)" }}>{b.value.toLocaleString()}</span>
            <div className="w-full rounded-t-md" style={{ height: Math.max(Math.round((b.value / max) * TRACK_PX), 6), background: b.color }} />
          </div>
        ))}
      </div>
      <div className="flex gap-6 mt-2">
        {bars.map((b, i) => (
          <div key={i} className="flex-1 flex flex-col items-center">
            <span className="text-[11px] font-semibold text-glass-text-secondary">{b.label}</span>
            <span className="text-[10px] uppercase tracking-wider text-glass-text-tertiary">{b.sub}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Difference vs a comparison season at the same day of registration. Green =
// ahead of that season's pace, red = behind. null when the feed is missing a side.
function RegDeltaCard({ title, subtitle, delta }: {
  title: string; subtitle: string; delta: number | null;
}) {
  const color =
    delta === null || delta === 0 ? "var(--glass-text)" :
    delta > 0 ? "rgb(74,222,128)" : "rgb(248,113,113)";
  return (
    <div className="rounded-2xl border border-glass-border bg-glass-surface p-4">
      <h3 className="text-sm font-semibold" style={{ color: "var(--glass-text)" }}>{title}</h3>
      <p className="text-[11px] mt-0.5 text-glass-text-tertiary">{subtitle}</p>
      <p className="text-3xl font-bold tabular mt-2" style={{ color }}>
        {delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta.toLocaleString()}`}
      </p>
    </div>
  );
}

const deltaColor = (d: number) =>
  d === 0 ? "var(--glass-text-secondary)" : d > 0 ? "rgb(74,222,128)" : "rgb(248,113,113)";
const signed = (d: number) => `${d > 0 ? "+" : ""}${d.toLocaleString()}`;

// One metric column inside a location card: count + both same-day deltas.
function LocationMetric({ label, cur, prev, year, prevLabel, yearLabel }: {
  label: string; cur: number; prev: number; year: number; prevLabel: string; yearLabel: string;
}) {
  const dPrev = cur - prev, dYear = cur - year;
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-glass-text-tertiary">{label}</p>
      <p className="text-2xl font-bold tabular leading-tight" style={{ color: "var(--glass-text)" }}>{cur.toLocaleString()}</p>
      <p className="text-[11px] font-semibold mt-1" style={{ color: deltaColor(dPrev) }}>
        {signed(dPrev)} <span className="font-normal text-glass-text-tertiary">vs {prevLabel}</span>
      </p>
      <p className="text-[11px] font-semibold" style={{ color: deltaColor(dYear) }}>
        {signed(dYear)} <span className="font-normal text-glass-text-tertiary">vs {yearLabel}</span>
      </p>
    </div>
  );
}

// Horizontally scrolling strip of per-location cards. Each card carries both
// teams and athletes so a location reads as one unit instead of forcing you to
// scroll two rows in sync to compare them.
function LocationStrip({ locations, prevLabel, yearLabel, season }: {
  locations: PacingLocation[];
  prevLabel: string;
  yearLabel: string;
  season: string;
}) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-glass-text-tertiary mb-2">By location</h3>
      <div className="flex gap-3 overflow-x-auto pb-2 snap-x">
        {locations.map((l) => {
          const get = (kind: string, metric: "captains" | "athletes") =>
            l.seasons.find((s) => s.kind === kind)?.[metric] ?? 0;
          const curTeams = get("current", "captains");
          const avgPerTeam = curTeams ? get("current", "athletes") / curTeams : null;
          // >= 8.5 green, >= 7.5 yellow, below red.
          const avgColor =
            avgPerTeam === null ? "var(--glass-text-secondary)"
              : avgPerTeam >= 8.5 ? "rgb(74,222,128)"
                : avgPerTeam >= 7.5 ? "var(--glass-gold)"
                  : "rgb(248,113,113)";
          return (
            <div key={l.location}
              className="snap-start shrink-0 w-[232px] rounded-xl border border-glass-border bg-glass-surface p-3.5">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-xs font-semibold truncate" style={{ color: "var(--glass-text)" }} title={l.location}>
                  {l.location}
                </p>
                <p className="text-xs font-semibold tabular shrink-0" title="Average athletes per team"
                  style={{ color: avgColor }}>
                  {avgPerTeam === null ? "—" : avgPerTeam.toFixed(1)}
                  <span className="font-normal text-glass-text-tertiary"> / team</span>
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 mt-2.5">
                <LocationMetric label="Teams"
                  cur={get("current", "captains")} prev={get("prev_season", "captains")} year={get("prev_year", "captains")}
                  prevLabel={prevLabel} yearLabel={yearLabel} />
                <LocationMetric label="Athletes"
                  cur={get("current", "athletes")} prev={get("prev_season", "athletes")} year={get("prev_year", "athletes")}
                  prevLabel={prevLabel} yearLabel={yearLabel} />
              </div>
              <div className="mt-3 flex items-end justify-between gap-2">
                {l.retention ? (
                  <span className="text-[11px] leading-tight" title={`${l.retention.retained} of ${l.retention.prev_athletes} ${prevLabel} athletes registered again this season`}>
                    <span className="font-semibold" style={{ color: "var(--glass-text-secondary)" }}>{l.retention.pct}%</span>
                    <span className="text-glass-text-tertiary"> retained vs {prevLabel}</span>
                  </span>
                ) : <span />}
                <a href={`/registrations/location?loc=${encodeURIComponent(l.location)}&season=${encodeURIComponent(season)}`}
                  className="text-[11px] font-semibold hover:brightness-110 transition shrink-0" style={{ color: "var(--glass-gold)" }}>
                  More details →
                </a>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default async function DashboardView({
  searchParams,
  mode = "full",
}: {
  searchParams: Promise<{ season?: string; location?: string; lm?: string }>;
  mode?: "full" | "registrations";
}) {
  await requireUser();
  const isReg = mode === "registrations";
  const { season: seasonParam, location = "all", lm = "all" } = await searchParams;
  const admin = createAdminClient();

  const { data: latest } = await admin
    .from("daily_snapshots")
    .select("snapshot_date")
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const snapDate: string | null = latest?.snapshot_date ?? null;

  const activeLMs = await loadActiveLMs();
  // On the Dashboard the filter picks the PLAYING season and the Registrations
  // card reports one ahead of it (tagged), because the other sections' data
  // lives in the playing season. The Registrations tab has nothing else on it,
  // so there the filter picks the registration season directly — selecting
  // Fall '26 shows Fall '26 rather than silently reporting the season after.
  const { promoLocations, promoSeasons, selectedSeason, regSeason, locationNames } = await resolveScope(
    { season: seasonParam, location, lm },
    activeLMs,
    { defaultSeason: isReg ? "registration" : "playing" },
  );
  const pacingSeason = isReg ? selectedSeason : regSeason;

  // Live, season + location/LM scoped section cards (fall back to sample if unwired).
  const scope: Scope = { lm, location, locationNames };
  // Registrations mode shows only the Registrations section, so skip the other
  // source loads entirely — just fetch pacing.
  const [ckCurrent, ckNext, feedbackTiles, statsTiles, contentTiles, promoTiles, overdueTiles, pacing] = await Promise.all([
    isReg ? Promise.resolve(null) : loadChecklistTiles(selectedSeason, scope),
    isReg ? Promise.resolve(null) : loadChecklistTiles(regSeason, scope),
    isReg ? Promise.resolve(null) : loadFeedbackTiles(selectedSeason, scope),
    isReg ? Promise.resolve(null) : loadStatsTiles(selectedSeason, scope),
    isReg ? Promise.resolve(null) : loadContentTiles(selectedSeason, scope),
    isReg ? Promise.resolve(null) : loadPromoTiles(regSeason, scope),
    isReg ? Promise.resolve(null) : loadOverdueTiles(selectedSeason, scope),
    loadRegistrationPacing(pacingSeason, scope),
  ]);
  const pacingCurrent = pacing?.seasons.find((s) => s.kind === "current");
  const pacingPrevSeason = pacing?.seasons.find((s) => s.kind === "prev_season");
  const pacingPrevYear = pacing?.seasons.find((s) => s.kind === "prev_year");
  // Same-day difference: current season minus the comparison season at day N.
  const regDelta = (metric: "captains" | "athletes", against: typeof pacingPrevSeason) =>
    pacingCurrent && against ? pacingCurrent[metric] - against[metric] : null;
  const regBars = (metric: "captains" | "athletes") =>
    (pacing?.seasons ?? []).map((s) => ({ label: s.season, sub: KIND_LABEL[s.kind] ?? s.kind, value: s[metric], color: REG_COLOR[s.kind] ?? "var(--glass-border-light)" }));
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
        <p className="font-mono text-xs uppercase tracking-[0.18em] mb-1" style={{ color: "var(--glass-gold)" }}>{isReg ? "Registrations" : "Dashboard"}</p>
        <h1 className="text-3xl font-semibold tracking-tight" style={{ color: "var(--glass-text)" }}>{isReg ? "Registration pacing" : "League overview"}</h1>
        <p className="text-sm mt-1 text-glass-text-secondary">
          {isReg
            ? <>Teams &amp; athletes at day N of registration for {scopeLabel}, vs the previous season and last year.</>
            : <>Cross-app health for {scopeLabel}.{snapDate ? ` As of ${snapDate}.` : ""}</>}
        </p>
      </header>

      <Filters key={`${selectedSeason}|${location}|${lm}`} options={options} current={{ season: selectedSeason, location, lm }} />

      <div className="space-y-8">
        {!isReg && (
          <Section title="Season Success Checklist" href={APP_URL.checklist} tiles={checklistTiles ?? SAMPLE.checklist} sample={!checklistTiles} />
        )}
        {pacing && pacingCurrent ? (
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <h2 className="text-lg font-semibold" style={{ color: "var(--glass-text)" }}>Registrations</h2>
                <span className="text-[9px] uppercase tracking-[0.16em] font-bold px-1.5 py-0.5 rounded"
                  style={{ background: "var(--glass-gold-light, rgba(255,184,0,0.16))", color: "var(--glass-gold)" }}>{pacingSeason}</span>
              </div>
              <a href={APP_URL.promo} target="_blank" rel="noopener noreferrer"
                className="text-xs font-semibold shrink-0 hover:brightness-110 transition" style={{ color: "var(--glass-gold)" }}>More details →</a>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <RegBarCard title="Total teams" subtitle={`captain registrations · day ${pacing.day_n ?? "?"} of registration`} current={pacingCurrent.captains} bars={regBars("captains")} />
              <RegBarCard title="Total athletes" subtitle={`athlete registrations · day ${pacing.day_n ?? "?"} of registration`} current={pacingCurrent.athletes} bars={regBars("athletes")} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <RegDeltaCard
                title="Teams vs prev season"
                subtitle={`${pacingCurrent.season} vs ${pacingPrevSeason?.season ?? "—"} · day ${pacing.day_n ?? "?"}`}
                delta={regDelta("captains", pacingPrevSeason)} />
              <RegDeltaCard
                title="Teams vs last year"
                subtitle={`${pacingCurrent.season} vs ${pacingPrevYear?.season ?? "—"} · day ${pacing.day_n ?? "?"}`}
                delta={regDelta("captains", pacingPrevYear)} />
              <RegDeltaCard
                title="Athletes vs prev season"
                subtitle={`${pacingCurrent.season} vs ${pacingPrevSeason?.season ?? "—"} · day ${pacing.day_n ?? "?"}`}
                delta={regDelta("athletes", pacingPrevSeason)} />
              <RegDeltaCard
                title="Athletes vs last year"
                subtitle={`${pacingCurrent.season} vs ${pacingPrevYear?.season ?? "—"} · day ${pacing.day_n ?? "?"}`}
                delta={regDelta("athletes", pacingPrevYear)} />
            </div>
            {pacing.locations?.length ? (
              <div className="pt-1">
                <LocationStrip
                  locations={pacing.locations}
                  prevLabel={shortSeason(pacingPrevSeason?.season ?? "")}
                  yearLabel={shortSeason(pacingPrevYear?.season ?? "")}
                  season={pacingCurrent.season} />
              </div>
            ) : null}
          </section>
        ) : (
          <Section title="Registrations" href={APP_URL.crm} tiles={realTiles("crm")} seasonTag={pacingSeason} />
        )}
        {!isReg && (
          <>
            <Section title="Registration Promo Tracker" href={APP_URL.promo} tiles={promoTiles ?? SAMPLE.promo} sample={!promoTiles} seasonTag={regSeason} />
            <Section title="Stats Health" href={APP_URL.stats_health} tiles={statsTiles ?? SAMPLE.stats_health} sample={!statsTiles} />
            <Section title="Content Health" href={APP_URL.content_health} tiles={contentTiles ?? SAMPLE.content} sample={!contentTiles} />
            <Section title="Feedback" href={APP_URL.feedback} tiles={feedbackTiles ?? SAMPLE.feedback} sample={!feedbackTiles} />
            <Section title="Overdue Payments" href={APP_URL.overdue} tiles={overdueTiles ?? SAMPLE.overdue} sample={!overdueTiles} />
          </>
        )}
      </div>

      {!isReg && (
        <p className="text-xs text-glass-text-tertiary">
          Feedback, Stats Health, and Content Health read live from each source, scoped to the selected Season, Location,
          and League manager (locations reconciled across apps by fuzzy match). Registration + Promo run one season ahead
          (the prep season, tagged in gold), and the Checklist shows both. The Promo Tracker card reads live from the Promo
          Tracker&apos;s own KPI feed, so its numbers match that site exactly.
        </p>
      )}
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
