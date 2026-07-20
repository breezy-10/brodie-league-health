-- Per-user location assignments. A user can cover several locations; this is a
-- generic user -> location map (any role), separate from the league_managers
-- scoring roster so assigning a location to an admin never adds them to scoring.
-- location_name matches the canonical Promo Tracker location names used by the
-- dashboard filter.

create table if not exists user_locations (
  user_id uuid not null references profiles(id) on delete cascade,
  location_name text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, location_name)
);
create index if not exists idx_user_locations_user on user_locations(user_id);

alter table user_locations enable row level security;

-- Reads for any signed-in user. Writes flow through the service-role client in
-- server actions (gated by requireRole), so only a super_admin RLS write policy
-- is needed for completeness.
create policy user_locations_read on user_locations
  for select using (auth.uid() is not null);
create policy user_locations_write on user_locations
  for all
  using (current_role_for_user() = 'super_admin')
  with check (current_role_for_user() = 'super_admin');
