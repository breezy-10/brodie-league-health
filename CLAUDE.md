# brodie-league-health — Claude notes

## Stack

- Next 15 App Router, TypeScript, Tailwind, Supabase (own project), Vercel.
- Auth: Google OAuth via Supabase. Allowed-domain gate in `middleware.ts`.
- Roles: `lm` (default) / `dm` / `super_admin`. Stored on `profiles`.

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
