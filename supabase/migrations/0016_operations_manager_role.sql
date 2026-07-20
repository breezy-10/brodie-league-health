-- Add the operations_manager role. It sits alongside dm: can add/edit users
-- (via the app's service-role-backed server actions, gated by requireRole) but
-- does not see the full Settings hub. dm was demoted from "admin" at the app
-- layer; only super_admin now sees the whole hub. RLS policies still key on
-- ('dm','super_admin') and intentionally grant operations_manager no direct
-- table access — every privileged surface goes through the service role.

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('lm', 'dm', 'operations_manager', 'super_admin'));
