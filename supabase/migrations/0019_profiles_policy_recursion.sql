-- current_role_for_user() reads public.profiles, and the profiles read policy
-- calls current_role_for_user(). Without SECURITY DEFINER the inner read is
-- itself subject to the policy, so evaluating the policy re-enters it:
--
--   ERROR: 54001 stack depth limit exceeded
--   CONTEXT: SQL function "current_role_for_user" during startup
--
-- It survives unnoticed because the policy is
--   (id = auth.uid()) OR (current_role_for_user() = 'super_admin')
-- and Postgres short-circuits the OR on your own row — so reading your own
-- profile works, and signing in works. Any query that has to consider another
-- user's row recurses and errors out.
--
-- SECURITY DEFINER makes the inner read bypass RLS, which is the point of a
-- policy helper. search_path is pinned so the definer's rights cannot be
-- pointed at another schema's profiles.
create or replace function public.current_role_for_user()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from profiles where id = auth.uid()
$$;
