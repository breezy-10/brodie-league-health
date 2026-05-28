-- 0014_goals_onboarding_audit.sql
-- Three small additions bundled because they're all column-or-table adds:
--   1. profiles.personal_goal_pct          (LM-set target)
--   2. league_managers.welcome_sent_at     (so onboarding Slacks once)
--   3. audit_log table                     (who did what, when, with what payload)

-- 1. Personal goal — 0..100, nullable (no goal set yet).
alter table profiles
  add column if not exists personal_goal_pct smallint
    check (personal_goal_pct is null or (personal_goal_pct between 0 and 100));

comment on column profiles.personal_goal_pct is
  'LM-self-set target percentage of max XP. Drawn as a reference line on the
   30-day score history chart. NULL = no goal set yet.';

-- 2. Auto-onboarding: track when we Slacked an LM their welcome message,
--    so the daily cron doesn''t pester them every run.
alter table league_managers
  add column if not exists welcome_sent_at timestamptz;

comment on column league_managers.welcome_sent_at is
  'Timestamp the new-LM welcome Slack DM was sent. NULL = LM has not been
   welcomed yet (cron will Slack them on the next pass).';

-- 3. Audit log — append-only record of consequential actions.
--    actor_id = profiles.id who did the thing. action is a short slug.
--    target_type + target_id describe what was acted on. payload is freeform.
create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_id uuid references profiles(id) on delete set null,
  actor_email text,            -- denormalized so deleted users still show
  action text not null,        -- e.g. dispute_resolved, weight_changed, view_as
  target_type text,            -- e.g. metric_dispute, app, lm
  target_id text,              -- uuid or other identifier as text
  payload jsonb not null default '{}'::jsonb
);

create index if not exists idx_audit_log_created on audit_log(created_at desc);
create index if not exists idx_audit_log_actor on audit_log(actor_id, created_at desc);
create index if not exists idx_audit_log_action on audit_log(action, created_at desc);
create index if not exists idx_audit_log_target on audit_log(target_type, target_id);

alter table audit_log enable row level security;

-- Only super_admin and dm can read. Writes go through service-role
-- (the logAudit helper uses createAdminClient), so we don't need an
-- insert policy for authenticated users.
create policy audit_log_admin_read on audit_log for select to authenticated
  using (current_role_for_user() in ('dm', 'super_admin'));

comment on table audit_log is
  'Append-only ledger of consequential actions: dispute resolves, weight
   changes, admin view-as sessions, manual XP nudges. Read by /admin/audit-log.';
