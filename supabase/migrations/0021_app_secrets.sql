-- Server-side secrets League Health needs at runtime, kept in its own database
-- rather than Vercel settings. RLS is on with NO policies, so only the service
-- role (which bypasses RLS) can read or write a row — signed-in users and the
-- anon key get nothing.
--
-- overdue_feed_key: the bearer the overdue app accepts on /api/checkin-stats
-- (LEAGUE_HEALTH_FEED_KEY on brodie-overdue-payments).
create table if not exists app_secrets (
  name       text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

alter table app_secrets enable row level security;
revoke all on app_secrets from anon, authenticated;
