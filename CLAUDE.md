# brodie-league-health — Claude notes

## Stack

- Next 15 App Router, TypeScript, Tailwind, Supabase (own project), Vercel.
- Auth: Google OAuth via Supabase. Allowed-domain gate in `middleware.ts`.
- Roles: `lm` (default) / `dm` / `operations_manager` / `super_admin`. Stored on
  `profiles`. Only `super_admin` is a full admin (sees the whole nav + Settings
  hub). `dm` + `operations_manager` get Dashboard + Users (can add/edit users,
  but not grant/edit super_admins). `lm` gets Dashboard only.
- User -> location assignments live in `user_locations` (many per user, any
  role), set on invite/edit. Generic and separate from the `league_managers`
  scoring roster. Picker names come from the Promo Tracker canonical list
  (`src/lib/locations.ts`), matching the dashboard's location filter.

## Where things live

- `src/lib/source-apps/adapters/` — one file per source app. Each exports an
  `Adapter` with a `sync(snapshotDate)` returning `LMRollup[]`.
- `src/lib/source-apps/clients.ts` — service-role client factories by env.
- `src/lib/scoring/engine.ts` — orchestrates: roster sync → adapter sync →
  daily_snapshots upsert → action items refresh → `recomputeScores`.
- `src/lib/slack/digest.ts` — formats + sends per-LM Slack DMs.
- `src/app/page.tsx` — LM "My Day" view.
- `src/app/leaderboard/page.tsx` — opt-in board.
- `src/app/admin/*` — DM/super-admin views; weight editor in `/admin/weights`.
- `src/app/api/cron/*` — three cron endpoints (sync-all, score, slack-digest).
- `src/app/api/admin/refresh/route.ts` — manual full refresh.
- `supabase/migrations/0001_init.sql` — schema + seed apps/metrics + RLS.

## Adding a new source app

1. Add the slug to `AppSlug` in `src/lib/source-apps/clients.ts`.
2. Add `<APP>_SUPABASE_URL` and `<APP>_SUPABASE_SERVICE_ROLE_KEY` env vars.
3. Insert app + metrics rows (or use the admin weight editor after seeding).
4. Write `src/lib/source-apps/adapters/<slug>.ts` implementing `Adapter`.
5. Register it in `src/lib/source-apps/index.ts`.

## Adding a sub-metric to an existing app

1. Insert the metric row in `metrics` (give it a `slug`, `weight_within_app`).
2. Have the adapter return a `MetricResult` with that `metric_slug`.
3. Optional: have the adapter emit an action item when the metric is bad.

## Scoring math (in case it's not obvious from the code)

Per LM:
```
metric_share  = metric.weight_within_app / sum(weights in same app)
app_share     = app.weight / sum(enabled app weights)
xp += metric.score * app_share * metric_share
max += metric.max_score * app_share * metric_share
```

So weights are relative inside their scope (within-app + across-apps).
You can move them around without recalculating absolutes.

## Daily flow

- 05:00 cron `/api/cron/sync-all` → 7 adapters write `daily_snapshots`,
  refresh `daily_action_items` for today.
- 05:30 cron `/api/cron/score` → `recomputeScores()` writes
  `lm_xp_totals` and ranks.
- 08:00 cron `/api/cron/slack-digest` → DMs each LM with `slack_user_id`.
- Manual "Refresh now" button on `/admin` re-runs sync + score.

## Design system

The look is the **Brodie Design Library** (Connor's kit, built from the Lab
and Cashflow): https://claude.ai/artifact/4kQ1GoCHRUqQvCqkZBzAtw. Read its
README and `rebrand.md` before changing any UI. Feedback and Overdue Payments
are built the same way.

- `src/styles/brodie/tokens.css` is generated from the library's
  `tokens.json`; `bundle.css` is the kit verbatim, minus its Google Fonts
  `@import` (next/font self-hosts Inter and IBM Plex Mono). Both load after
  `globals.css`. Re-download and regenerate them rather than editing.
- **Light first, dark by request.** The kit is light only; this app keeps an
  opt-in dark mode in `src/styles/brodie/dark.css`, a layer keyed on
  `[data-theme="dark"]` with the Lab's dark values. The theme is the
  `brodie-league-health-theme` cookie (`lib/theme.ts`), so the server renders
  it; ThemeScript migrates a choice made with the old toggle (localStorage
  `blh-theme`). The toggle is a row in the account menu.
- The app's older variables (`--accent`, `--text`, `--bg-raised`, `--glass-*`)
  point at kit tokens in `globals.css`, so older components follow both
  themes. Gold is gone: emphasis and selection are ink, Brodie red is for what
  needs a person and for this season on a chart (`--viz-now`; past seasons are
  `--viz-prev` / `--viz-prev-2` greys).
- The shell is the kit's markup in `components/AppShell.tsx`, rendered by
  `components/Shell.tsx` from `(app)/layout.tsx`. bundle.js is not loaded;
  React owns the sidebar, tab bar and menus. Page titles and their
  one-sentence subtitles live in the `PAGES` map in AppShell; a page keeps a
  line of its own (`.page-h2`, `.page-lede`) only for what changes with the
  view: a person's name, the scope, how fresh the numbers are.
- Sentence case everywhere; mono only for literal codes. Cards are white,
  borderless, `rounded-2xl shadow-card` (18px, the kit shadow). Primary
  buttons are black pills (`br-btn`), secondary ones grey; segmented controls
  are `br-seg`; status chips are tinted pills with a word.
- The page scrolls the window, under the kit's sticky header, so anything
  sticky uses `top: var(--shell-top)`. The exception is a header inside a
  box that scrolls on its own (`overflow` with a `max-height`, like the
  Ambassadors table): it sticks to that box, so it uses `top-0`. The kit's sidebar and header sit at
  z-index 900-1000; overlays use `z-[10070]` on `var(--scrim-strong)`.
