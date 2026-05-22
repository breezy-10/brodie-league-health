-- brodie-league-health initial schema
-- Aggregates daily metrics from 7 Brodie apps and scores LMs.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- profiles (mirrors auth.users with role)
-- ---------------------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  role text not null default 'lm' check (role in ('lm', 'dm', 'super_admin')),
  slack_user_id text,
  opt_in_leaderboard boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- league_managers (denormalized roster — synced from brodie-crm.managers)
-- ---------------------------------------------------------------------------
create table if not exists league_managers (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id) on delete set null,
  email text not null unique,
  full_name text,
  location_name text,
  district text,
  active boolean not null default true,
  slack_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_league_managers_active on league_managers(active);

-- ---------------------------------------------------------------------------
-- apps (the 7 source apps we score against)
-- ---------------------------------------------------------------------------
create table if not exists apps (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  weight numeric not null default 0 check (weight >= 0),
  enabled boolean not null default true,
  display_order int not null default 0,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- metrics (sub-metrics per app — each carries weight_within_app)
-- ---------------------------------------------------------------------------
create table if not exists metrics (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references apps(id) on delete cascade,
  slug text not null,
  name text not null,
  weight_within_app numeric not null default 0 check (weight_within_app >= 0),
  scoring_rule jsonb not null default '{}'::jsonb,
  direction text not null default 'higher_better' check (direction in ('higher_better', 'lower_better')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (app_id, slug)
);

-- ---------------------------------------------------------------------------
-- daily_snapshots (raw metric values per LM per day)
-- ---------------------------------------------------------------------------
create table if not exists daily_snapshots (
  id uuid primary key default gen_random_uuid(),
  lm_id uuid not null references league_managers(id) on delete cascade,
  app_id uuid not null references apps(id) on delete cascade,
  metric_id uuid not null references metrics(id) on delete cascade,
  snapshot_date date not null,
  raw_value numeric,
  raw_payload jsonb,
  score numeric not null default 0,
  max_score numeric not null default 100,
  captured_at timestamptz not null default now(),
  unique (lm_id, metric_id, snapshot_date)
);
create index if not exists idx_daily_snapshots_lm_date on daily_snapshots(lm_id, snapshot_date desc);
create index if not exists idx_daily_snapshots_date on daily_snapshots(snapshot_date desc);

-- ---------------------------------------------------------------------------
-- daily_action_items (the "what you need to do today" digest rows)
-- ---------------------------------------------------------------------------
create table if not exists daily_action_items (
  id uuid primary key default gen_random_uuid(),
  lm_id uuid not null references league_managers(id) on delete cascade,
  app_id uuid not null references apps(id) on delete cascade,
  metric_id uuid references metrics(id) on delete set null,
  snapshot_date date not null,
  title text not null,
  detail text,
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high', 'critical')),
  source_ref text,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_action_items_lm_date on daily_action_items(lm_id, snapshot_date desc);
create index if not exists idx_action_items_unresolved on daily_action_items(lm_id) where resolved_at is null;

-- ---------------------------------------------------------------------------
-- lm_xp_totals (per LM per day rollup)
-- ---------------------------------------------------------------------------
create table if not exists lm_xp_totals (
  id uuid primary key default gen_random_uuid(),
  lm_id uuid not null references league_managers(id) on delete cascade,
  snapshot_date date not null,
  total_xp numeric not null default 0,
  max_xp numeric not null default 100,
  pct numeric generated always as (case when max_xp > 0 then (total_xp / max_xp) * 100 else 0 end) stored,
  breakdown jsonb not null default '{}'::jsonb,
  rank_overall int,
  computed_at timestamptz not null default now(),
  unique (lm_id, snapshot_date)
);
create index if not exists idx_lm_xp_date on lm_xp_totals(snapshot_date desc, total_xp desc);

-- ---------------------------------------------------------------------------
-- weight_history (audit trail for weight changes)
-- ---------------------------------------------------------------------------
create table if not exists weight_history (
  id uuid primary key default gen_random_uuid(),
  changed_by uuid references profiles(id) on delete set null,
  changed_at timestamptz not null default now(),
  scope text not null check (scope in ('app', 'metric')),
  target_id uuid not null,
  old_weight numeric,
  new_weight numeric,
  note text
);

-- ---------------------------------------------------------------------------
-- sync_runs (per-adapter sync health)
-- ---------------------------------------------------------------------------
create table if not exists sync_runs (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references apps(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'success', 'partial', 'error')),
  rows_synced int,
  error text,
  triggered_by text not null default 'cron' check (triggered_by in ('cron', 'manual'))
);
create index if not exists idx_sync_runs_app_started on sync_runs(app_id, started_at desc);

-- ---------------------------------------------------------------------------
-- Seed apps + metrics with default weights
-- ---------------------------------------------------------------------------
insert into apps (slug, name, weight, display_order, description) values
  ('crm',            'Brodie CRM',          30, 1, 'Registration, lead follow-up, captain pipeline'),
  ('facilities',     'Facilities',          20, 2, 'Contracts, invoices, facility audits'),
  ('ref_payroll',    'Ref Payroll',         15, 3, 'On-time ref payouts'),
  ('training',       'Training',            12, 4, 'Staff cert completion'),
  ('stats_health',   'Stats Health',        10, 5, 'Game stat logging timeliness'),
  ('content_health', 'Content Health',       8, 6, 'Game content posting timeliness'),
  ('ops_schedule',   'Ops Schedule',         5, 7, 'Shift coverage')
on conflict (slug) do nothing;

-- Metrics seeding (uses CTE to get app ids)
with a as (select id, slug from apps)
insert into metrics (app_id, slug, name, weight_within_app, direction, scoring_rule) values
  ((select id from a where slug='crm'),            'reg_pace',           'Registration pace vs goal',     50, 'higher_better', '{"target_pct": 100}'::jsonb),
  ((select id from a where slug='crm'),            'lead_response_sla',  'Lead response < 24h',           30, 'higher_better', '{"sla_hours": 24}'::jsonb),
  ((select id from a where slug='crm'),            'captain_followup',   'Captain follow-up cadence',     20, 'higher_better', '{}'::jsonb),

  ((select id from a where slug='facilities'),     'invoice_on_time',    'Invoices paid on time',         60, 'higher_better', '{}'::jsonb),
  ((select id from a where slug='facilities'),     'contract_gap_risk',  'No contract gap looming',       40, 'higher_better', '{"warn_days": 30}'::jsonb),

  ((select id from a where slug='ref_payroll'),    'payouts_on_time',    'Refs paid by Tuesday EOD',      80, 'higher_better', '{}'::jsonb),
  ((select id from a where slug='ref_payroll'),    'no_overdue',         'No overdue ref payouts',        20, 'higher_better', '{}'::jsonb),

  ((select id from a where slug='training'),       'cert_current',       'Staff certs current',           70, 'higher_better', '{}'::jsonb),
  ((select id from a where slug='training'),       'module_completion',  'Assigned module completion',    30, 'higher_better', '{}'::jsonb),

  ((select id from a where slug='stats_health'),   'stats_in_24h',       'Stats logged within 24h',      100, 'higher_better', '{"sla_hours": 24}'::jsonb),

  ((select id from a where slug='content_health'), 'content_in_48h',     'Content posted within 48h',    100, 'higher_better', '{"sla_hours": 48}'::jsonb),

  ((select id from a where slug='ops_schedule'),   'shifts_7d_out',      'Shifts filled 7 days out',      70, 'higher_better', '{}'::jsonb),
  ((select id from a where slug='ops_schedule'),   'drop_rate',          'Low last-minute drop rate',     30, 'lower_better',  '{}'::jsonb)
on conflict (app_id, slug) do nothing;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table profiles enable row level security;
alter table league_managers enable row level security;
alter table apps enable row level security;
alter table metrics enable row level security;
alter table daily_snapshots enable row level security;
alter table daily_action_items enable row level security;
alter table lm_xp_totals enable row level security;
alter table weight_history enable row level security;
alter table sync_runs enable row level security;

-- helper: current user's role
create or replace function current_role_for_user() returns text language sql stable as $$
  select role from profiles where id = auth.uid()
$$;

-- helper: current user's lm_id (matched by email)
create or replace function current_lm_id() returns uuid language sql stable as $$
  select lm.id from league_managers lm
  join profiles p on lower(p.email) = lower(lm.email)
  where p.id = auth.uid()
  limit 1
$$;

-- profiles: user sees own; super_admin sees all
create policy profiles_self_read on profiles for select to authenticated
  using (id = auth.uid() or current_role_for_user() = 'super_admin');
create policy profiles_self_update on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- apps + metrics: readable to all authenticated; writable only by super_admin / dm
create policy apps_read on apps for select to authenticated using (true);
create policy apps_write on apps for all to authenticated
  using (current_role_for_user() in ('dm', 'super_admin'))
  with check (current_role_for_user() in ('dm', 'super_admin'));

create policy metrics_read on metrics for select to authenticated using (true);
create policy metrics_write on metrics for all to authenticated
  using (current_role_for_user() in ('dm', 'super_admin'))
  with check (current_role_for_user() in ('dm', 'super_admin'));

-- league_managers: lm sees self row + everyone if leaderboard opted in;
-- dm + super_admin see all
create policy lm_self_read on league_managers for select to authenticated
  using (
    id = current_lm_id()
    or current_role_for_user() in ('dm', 'super_admin')
    or exists (select 1 from profiles p where p.id = auth.uid() and p.opt_in_leaderboard)
  );
create policy lm_admin_write on league_managers for all to authenticated
  using (current_role_for_user() in ('dm', 'super_admin'))
  with check (current_role_for_user() in ('dm', 'super_admin'));

-- daily_snapshots: own rows; admins see all
create policy snapshots_self_read on daily_snapshots for select to authenticated
  using (lm_id = current_lm_id() or current_role_for_user() in ('dm', 'super_admin'));

-- daily_action_items: own rows; admins see all
create policy actions_self_read on daily_action_items for select to authenticated
  using (lm_id = current_lm_id() or current_role_for_user() in ('dm', 'super_admin'));
create policy actions_self_resolve on daily_action_items for update to authenticated
  using (lm_id = current_lm_id() or current_role_for_user() in ('dm', 'super_admin'))
  with check (lm_id = current_lm_id() or current_role_for_user() in ('dm', 'super_admin'));

-- lm_xp_totals: own rows for LM; opt-in leaderboard view for peers; admins all
create policy xp_self_read on lm_xp_totals for select to authenticated
  using (
    lm_id = current_lm_id()
    or current_role_for_user() in ('dm', 'super_admin')
    or exists (
      select 1 from league_managers lm
      join profiles p on lower(p.email) = lower(lm.email)
      where lm.id = lm_xp_totals.lm_id and p.opt_in_leaderboard
    )
  );

-- weight_history: admins only
create policy weight_history_admin on weight_history for all to authenticated
  using (current_role_for_user() in ('dm', 'super_admin'))
  with check (current_role_for_user() in ('dm', 'super_admin'));

-- sync_runs: admins only
create policy sync_runs_admin on sync_runs for select to authenticated
  using (current_role_for_user() in ('dm', 'super_admin'));

-- ---------------------------------------------------------------------------
-- trigger: bootstrap profile on new auth.user
-- ---------------------------------------------------------------------------
create or replace function handle_new_user() returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', new.email)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
