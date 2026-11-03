# brodie-league-health — Claude notes

## Stack

- Next 15 App Router, TypeScript, Tailwind, Supabase (own project), Vercel.
- Auth: Google OAuth via Supabase. Allowed-domain gate in `middleware.ts`.
- Roles: `lm` (default) / `dm` / `operations_manager` / `super_admin`. Stored on
  `profiles`. Only `super_admin` is a full admin (sees the whole nav + Settings
  hub). `dm` + `operations_manager` get Dashboard + Users (can add/edit users,
  but not grant/edit super_admins). `lm` gets Dashboard only.
- The Dashboard is labelled "DM/LM Dashboard". `/om-dashboard` ("OM Dashboard",
  in the nav for `operations_manager` + `super_admin`) is the same view in
  `mode="om"`: the operations managers' own Season Success checklist (kind
  `operations`, one league-wide checklist per season) instead of the league
  managers', and no Team Confirmed Stories, Outreach, Ambassador teams, Site
  Visits, Video Reviews, LM Game Day Checklist or Training sections. It adds
  Facility Payments (facilities `invoices`) and Referee Payments
  (ref-payroll `location_invoices`) under the bookings sections: every unpaid
  invoice, any season, by review step. Overdue weekly ref pay comes from
  ref-payroll's `GET /api/feeds/overdue-ref-pay` (its own
  `findOverduePayments`), bearer `REF_PAYROLL_FEED_KEY` here =
  `LEAGUE_HEALTH_FEED_KEY` there.
- The OM Dashboard's other sections each read a feed the source app publishes
  from its own code, behind its own key (`LEAGUE_HEALTH_FEED_KEY` in that app):
  - Ops Tickets and Court Bookings: B.O.B. `GET /api/ops-summary` (live ops
    and refund tickets, pending discounts and replacements, `computeCourtChecks`
    for the next 4 weeks), key `OVERDUE_FEED_KEY` / app_secrets
    `overdue_feed_key`, read once per render (`loadBobOps`, React `cache`).
  - Missing Facility Invoices (under Facility Payments) and Missing Referee
    Invoices (under Referee Payments): facilities `GET
    /api/feeds/missing-invoices` (key `FACILITIES_FEED_KEY`) and ref-payroll's
    (key `REF_PAYROLL_FEED_KEY`), the lists their Monday nudges send
    (`findMissingInvoices` in each).
  - Logistics: logistics `GET /api/feeds/ops-summary` (key
    `LOGISTICS_FEED_KEY`): supplier balances (its "Money still owed" rule) and
    stock at or under its reorder level. Its "ordered, not received" list is
    in the feed but not shown: received dates are rarely filled in, so it
    counted 273 orders back to Fall '25.
  - Venue Insurance reads facilities directly: secured venues booked in the
    season being played or sold, by certificate on file and expiry.
- User -> location assignments live in `user_locations` (many per user, any
  role), set on invite/edit. Generic and separate from the `league_managers`
  scoring roster. Picker names come from the Promo Tracker canonical list
  (`src/lib/locations.ts`), matching the dashboard's location filter.

## Roster comes from districts

`syncRoster` (`src/lib/roster.ts`, first step of the 05:00 sync-all job and
My Day's self-heal) builds the `league_managers` scoring roster from
brodie-districts' directory (`src/lib/directory.ts`, `GET /api/directory`,
env `DIRECTORY_FEED_TOKEN`), so a manager change is entered once, there.

- Every league manager districts names for an active location now gets a row,
  matched by email; a name districts has no email for matches an existing row
  or sign-in with the exact same full name, else it is listed as "no account"
  (placeholders like "Atlanta LM"). Rows are updated in place (ids are what
  scores hang off). Someone districts doesn't list keeps their row as it is,
  active, and is reported (`notInDistricts`): Destin Gross, Ekjot Sandhu and
  Shane McNabb aren't on districts rosters but are still at Brodie (Sohaib,
  2026-11-01). Rows are never deleted. Super admins never get an active row.
- Locations: `location_names` + `league_ids` (ops league ids, migration 0023)
  hold every location districts names them for, primary first;
  `location_name` stays the primary one for display. `district` is their
  district managers' names. `hired_at` is filled from Training's users table.
- With `DIRECTORY_SYNC=apply` it writes, and the adapters' league manager list
  and locations (`listLMsFromCRM` / `resolve*ForLM` in
  `source-apps/cross-app-locations.ts`) read the roster instead of CRM
  managers. Anything else is report only: the diff is logged and the old CRM
  copy (`syncRosterFromCrm`) keeps the roster as before. If districts can't be
  read with the switch on, the run is skipped rather than emptying anything.
- Dry run by hand (writes nothing):
  `set -a && source .env.local && set +a && npx tsx scripts/directory-sync-dry-run.ts`.
- This app's own `user_locations` (Settings > Users) is display only: nothing
  scopes by it, so the sync leaves it alone.

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
- `src/app/api/cron/*` — cron endpoints; sync-all and score are scheduled. slack-digest and weekly-slack-digest still exist but aren't scheduled (see Daily flow).
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
- No Slack digests: `/api/cron/slack-digest` (8am DM to each league manager, plus the new-hire welcome) and `/api/cron/weekly-slack-digest` were taken off the schedule in Nov 2026 when the app moved to Brodie League (Sohaib: the digest wasn't worth sending as it stood). The project has no `SLACK_BOT_TOKEN`, so access-request pings and dispute notices don't post to Slack either until one is added.
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

## Deploys and checks

- Merging to `main` deploys production automatically (Vercel's GitHub integration). Don't run `vercel --prod` from a local checkout: it deploys whatever is on disk, and a stale checkout has rolled production back before. The live site is the `brodie-league-health` project in the Brodie League team, at https://brodie-leaguehealth.vercel.app (moved 2026-11-01). The old address, brodie-league-health.vercel.app, belongs to a project in Amy's former personal Vercel account that nobody can reach; League Health's database keys were replaced and the old ones disabled, so that copy no longer works.
- Every PR runs `.github/workflows/checks.yml`: `.github/scripts/guards.mjs` (middleware in the folder Next reads, every scheduled job in `vercel.json` has a route that checks `CRON_SECRET`, no committed env files) and the type check.
- After each production deploy, `.github/workflows/after-deploy.yml` runs `.github/scripts/smoke.mjs` against https://brodie-leaguehealth.vercel.app: the home page must redirect to /login, /login must load, and every scheduled job's route must be reachable. A failed run means production is broken or a job has silently stopped; GitHub emails whoever merged.
- These files are the same in every Brodie app; change them in all of them.
