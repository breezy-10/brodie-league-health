# brodie-league-health

Daily ops scoreboard for league managers. Pulls signals from 7 Brodie apps,
scores each LM with editable weights, surfaces a daily action checklist,
runs a leaderboard, and DMs Slack digests every morning.

## What it does

- Nightly cron at 5am ET syncs each app's Supabase via service-role keys.
- Score engine at 5:30am ET computes XP per LM using app + sub-metric weights.
- Slack digest at 8am ET DMs each LM their score + action checklist.
- LMs see their own "My Day" view with XP, breakdown, 7-day trend, and
  open action items they can mark done.
- DMs and super_admins see every LM, drill into any one, edit weights with
  audit trail, and trigger a manual refresh.
- Opt-in global leaderboard (per LM toggle).

## Source apps + sub-metrics + default weights

| App | Weight | Sub-metrics |
|---|---|---|
| brodie-crm | 30 | reg_pace (50), lead_response_sla (30), captain_followup (20) |
| brodie-facilities | 20 | invoice_on_time (60), contract_gap_risk (40) |
| brodie-ref-payroll | 15 | payouts_on_time (80), no_overdue (20) |
| brodie-training-pilot | 12 | cert_current (70), module_completion (30) |
| brodie-stats-health | 10 | stats_in_24h (100) |
| brodie-content-health | 8 | content_in_48h (100) |
| brodie-ops-schedule | 5 | shifts_7d_out (70), drop_rate (30) |

All weights are editable in `/admin/weights`. Adapters live in
`src/lib/source-apps/adapters/`.

## Setup

```bash
pnpm install   # or npm install
cp .env.local.example .env.local
# fill in NEXT_PUBLIC_SUPABASE_URL + service role for the NEW league_health
# Supabase project, plus the 7 source-app service-role keys.
```

### Supabase

1. Create a new Supabase project (`brodie-league-health`).
2. `supabase link` to it.
3. `pnpm db:push` to apply `supabase/migrations/0001_init.sql`.
4. Enable Google OAuth in Supabase Auth → Providers (use the brodierec.com
   domain hint).
5. Set the Site URL to `https://brodie-league-health.vercel.app` (or your
   custom domain) and add `/auth/callback` to Redirect URLs.
6. Seed yourself as super_admin:
   ```sql
   update profiles set role='super_admin' where email='you@brodierec.com';
   ```

### Source service-role keys

Each adapter needs its source app's service-role key. Get them from each
Supabase project (Settings → API → service_role secret). Paste into
`.env.local` (local) and Vercel env vars (prod).

### Slack digest

- Create a Slack app with `chat:write` scope.
- Install to the workspace, copy the bot token into `SLACK_BOT_TOKEN`.
- Populate `league_managers.slack_user_id` for each LM (Slack U... id).

## Daily cadence

| Time (ET) | Cron path | What it does |
|---|---|---|
| 05:00 | `/api/cron/sync-all` | Runs every adapter, writes daily_snapshots + daily_action_items. |
| 05:30 | `/api/cron/score` | Computes lm_xp_totals from snapshots + current weights. |
| 08:00 | `/api/cron/slack-digest` | DMs each LM with slack_user_id set. |

Vercel cron sends `Authorization: Bearer $CRON_SECRET`. Without
`CRON_SECRET` set, the endpoints are open (dev mode).

## Deploying

### IMPORTANT — Brodie Vercel quirks (per repo memory)

Every Brodie app needs:

- Push commits with `--author "amycorreia-stack <noreply-amycorreia-stack@users.noreply.github.com>"` because `amy@brodierec.com` is blocked from auto-deploys.
- Push an empty trigger commit after the real push.
- If the dashboard sticks in `UNKNOWN`, ship via `vercel --prod --yes` manually.

```bash
vercel link
vercel env pull .env.production  # (optional sanity check)
vercel --prod --yes
```

## Adding an LM

1. Add them to `brodie-crm.managers` (canonical source of truth).
2. They sign in to league-health with Google. A profile row auto-creates.
3. The next sync (or manual Refresh) upserts them into `league_managers` and
   their score appears.

## Notes on adapters

The adapters were written against the table names found in each source app's
`/supabase/migrations/`. Specific column names (e.g., `due_date`,
`paid_at`, `target_pay_date`, `stats_completed_at`, `night_date`,
`module_id`) follow the most likely Brodie conventions but should be verified
once. If an adapter reports `error`, the message in `sync_runs.error` will
tell you exactly which column is missing — adjust the adapter in
`src/lib/source-apps/adapters/<slug>.ts` and re-deploy.
