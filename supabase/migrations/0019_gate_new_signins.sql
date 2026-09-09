-- Gate new sign-ins instead of letting every @brodierec.com account straight in.
--
-- This app had no approval step at all: sign in with a Brodie Google account and
-- you were through. Self-signups now arrive inactive and wait for an admin.
--
-- Existing users are untouched - all current profiles are backfilled active, so
-- this gates the door rather than purging the people already inside.

alter table public.profiles
  add column if not exists active boolean not null default false,
  add column if not exists requested_at timestamptz;

-- Grandfather everyone who already has a profile.
update public.profiles set active = true, requested_at = null;

-- Self-signups land inactive and flagged as waiting on a decision. Admin
-- invites are activated by the invite action right after this runs, so an
-- invited person is never left knocking.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $function$
begin
  insert into public.profiles (id, email, full_name, active, requested_at)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      new.email
    ),
    false,
    now()
  )
  on conflict (id) do nothing;
  return new;
exception when others then
  raise warning 'handle_new_user failed: %', sqlerrm;
  return new;
end;
$function$;

-- Clear the request marker on activation, whatever code path does it, so
-- archiving someone later cannot make them reappear as requested.
create or replace function public.clear_requested_on_activate()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.active and not old.active then
    new.requested_at := null;
  end if;
  return new;
end;
$function$;

drop trigger if exists clear_requested_on_activate on public.profiles;
create trigger clear_requested_on_activate
  before update on public.profiles
  for each row execute function public.clear_requested_on_activate();
