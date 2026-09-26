-- 0020_rls_hardening.sql — NOT YET APPLIED (security audit 2026-09-26)
--
-- Closes three holes in the RLS that the app never relied on but that anyone
-- holding a Supabase session JWT can reach directly through PostgREST with the
-- public anon key (no app code involved):
--
--   1. profiles_self_update let a user update EVERY column of their own row,
--      including `role` and `active`. Any signed-in account — a brand-new
--      self-signup still waiting on approval, or (if the Google provider is not
--      domain-locked in Supabase) any Google account — could PATCH itself to
--      role='super_admin', active=true and walk past the approval gate with full
--      admin reach. Fix: column-level UPDATE grant limited to the columns the
--      browser/user-session client actually writes (opt_in_leaderboard,
--      tour_completed_at, personal_goal_pct, updated_at). Role / active /
--      email / requested_at changes all go through the service-role client in
--      server actions, which bypasses these grants.
--
--   2. The helper functions treated an unapproved (active=false) profile the
--      same as an approved one, and several read policies were `using (true)`
--      for any authenticated session, so an unapproved or non-Brodie session
--      could read apps/metrics/achievements/compensation_config/referral_rates/
--      user_locations and — because opt_in_leaderboard defaults to true — the
--      whole league_managers roster (names, emails, locations) and everyone's
--      opted-in XP totals. Fix: helpers only return a role / lm id for ACTIVE
--      profiles, and the open read policies now require an active profile.
--
--   3. Helpers become SECURITY DEFINER (search_path pinned) so the policies on
--      `profiles` that call current_role_for_user() don't recurse through
--      profiles' own RLS. Execute is revoked from anon/public.
--
-- App impact: none for approved users. Every app page already runs
-- requireUser(), which sends inactive profiles to /request-access, and that
-- page only reads the caller's own profile row (profiles_self_read is keyed on
-- id = auth.uid(), unchanged). All privileged writes use the service role.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.current_role_for_user() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.current_lm_id() returns uuid
language sql stable security definer set search_path = public as $$
  select lm.id from public.league_managers lm
  join public.profiles p on lower(p.email) = lower(lm.email)
  where p.id = auth.uid() and p.active
  limit 1
$$;

create or replace function public.is_active_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active)
$$;

revoke execute on function public.current_role_for_user() from public, anon;
revoke execute on function public.current_lm_id() from public, anon;
revoke execute on function public.is_active_member() from public, anon;
grant execute on function public.current_role_for_user() to authenticated, service_role;
grant execute on function public.current_lm_id() to authenticated, service_role;
grant execute on function public.is_active_member() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. profiles: users may only touch their own preference columns
-- ---------------------------------------------------------------------------
revoke update on public.profiles from authenticated, anon;
grant update (opt_in_leaderboard, tour_completed_at, personal_goal_pct, updated_at)
  on public.profiles to authenticated;
-- Nothing legitimate inserts/deletes profiles with a user session (the
-- on_auth_user_created trigger and the service role do). No policy exists for
-- either, so RLS already denies; the revoke is belt-and-braces.
revoke insert, delete on public.profiles from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 2. open read policies -> approved members only
-- ---------------------------------------------------------------------------
drop policy if exists apps_read on public.apps;
create policy apps_read on public.apps for select to authenticated
  using (public.is_active_member());

drop policy if exists metrics_read on public.metrics;
create policy metrics_read on public.metrics for select to authenticated
  using (public.is_active_member());

drop policy if exists achievements_read on public.achievements;
create policy achievements_read on public.achievements for select to authenticated
  using (public.is_active_member());

drop policy if exists comp_config_read on public.compensation_config;
create policy comp_config_read on public.compensation_config for select to authenticated
  using (public.is_active_member());

drop policy if exists referral_rates_read on public.referral_rates;
create policy referral_rates_read on public.referral_rates for select to authenticated
  using (public.is_active_member());

drop policy if exists user_locations_read on public.user_locations;
create policy user_locations_read on public.user_locations for select to authenticated
  using (public.is_active_member());

drop policy if exists user_locations_write on public.user_locations;
create policy user_locations_write on public.user_locations for all to authenticated
  using (public.current_role_for_user() = 'super_admin')
  with check (public.current_role_for_user() = 'super_admin');

-- Leaderboard opt-in branch: the viewer must be an approved member too.
drop policy if exists lm_self_read on public.league_managers;
create policy lm_self_read on public.league_managers for select to authenticated
  using (
    id = public.current_lm_id()
    or public.current_role_for_user() in ('dm', 'super_admin')
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.active and p.opt_in_leaderboard
    )
  );

drop policy if exists xp_self_read on public.lm_xp_totals;
create policy xp_self_read on public.lm_xp_totals for select to authenticated
  using (
    lm_id = public.current_lm_id()
    or public.current_role_for_user() in ('dm', 'super_admin')
    or (
      public.is_active_member()
      and exists (
        select 1 from public.league_managers lm
        join public.profiles p on lower(p.email) = lower(lm.email)
        where lm.id = lm_xp_totals.lm_id and p.opt_in_leaderboard
      )
    )
  );
