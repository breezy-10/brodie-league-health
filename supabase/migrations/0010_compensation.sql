-- 0010_compensation.sql — bonus projection plumbing
-- Stores per-LM annual commission + the unlock rules that translate XP
-- performance into earned dollars. Rules are JSONB so HR can tune without
-- code changes. Locked 2026-05-28 with $40K base; thresholds editable.

create table if not exists compensation_config (
  id uuid primary key default gen_random_uuid(),
  -- Identifier so the config is versioned over time; only the most recent
  -- (where active=true) is used.
  active boolean not null default true,
  -- Default annual commission for any LM not in compensation_overrides
  annual_base_cents bigint not null default 4000000,  -- $40,000
  -- Tunable unlock thresholds. Default ladder: hit Pro tier monthly
  -- average → unlock 60% of pro-rated commission; Elite → 85%; Hall of
  -- Fame → 100%; Rookie → 0%. Floors at 0 if a month avg is negative.
  unlock_rules jsonb not null default '{
    "by_monthly_avg_pct": [
      {"min_avg_pct": 85, "share": 1.00, "label": "Hall of Fame"},
      {"min_avg_pct": 70, "share": 0.85, "label": "Elite"},
      {"min_avg_pct": 50, "share": 0.60, "label": "Pro"},
      {"min_avg_pct": 0,  "share": 0.00, "label": "Rookie"}
    ]
  }'::jsonb,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Optional per-LM override of annual_base_cents (for senior LMs, market
-- premiums, etc.). When absent, the default in compensation_config is used.
create table if not exists compensation_overrides (
  lm_id uuid primary key references league_managers(id) on delete cascade,
  annual_base_cents bigint not null,
  note text,
  updated_at timestamptz not null default now()
);

-- Seed one active config row so the page has something to read on first load
insert into compensation_config (active, annual_base_cents, note)
  values (true, 4000000, 'Default — $40K annual commission. Tune unlock_rules in Admin.')
  on conflict do nothing;

-- RLS — readable to all authenticated, writable only by super_admin
alter table compensation_config enable row level security;
alter table compensation_overrides enable row level security;

create policy comp_config_read on compensation_config for select to authenticated using (true);
create policy comp_config_admin on compensation_config for all to authenticated
  using (current_role_for_user() = 'super_admin')
  with check (current_role_for_user() = 'super_admin');

create policy comp_overrides_read on compensation_overrides for select to authenticated
  using (lm_id = current_lm_id() or current_role_for_user() in ('dm', 'super_admin'));
create policy comp_overrides_admin on compensation_overrides for all to authenticated
  using (current_role_for_user() = 'super_admin')
  with check (current_role_for_user() = 'super_admin');
