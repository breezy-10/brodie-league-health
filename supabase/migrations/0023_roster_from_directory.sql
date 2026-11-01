-- 0023_roster_from_directory.sql: the scoring roster follows brodie-districts.
--
-- syncRoster (src/lib/roster.ts) used to copy the CRM's hand-edited managers
-- table and keep only each league manager's FIRST location. With the directory
-- sync on (DIRECTORY_SYNC=apply), every league manager districts names for a
-- location now gets a row, with every location they run:
--
--   location_name   stays the primary location (one name, for display), and is
--                   always location_names[1]
--   location_names  every location districts names them for, primary first
--   league_ids      the ops league id (spt_leagues.id) of each, same order
--
-- Additive only: nothing reads the new columns until the sync fills them, and
-- the code falls back to location_name while they are null.

alter table league_managers
  add column if not exists location_names text[],
  add column if not exists league_ids text[];

comment on column league_managers.location_names is
  'Every location brodie-districts names this league manager for now, primary
   (location_name) first. Written by the directory sync; NULL = not synced yet.';
comment on column league_managers.league_ids is
  'Ops league ids (spt_leagues.id, the districts directory id) of location_names,
   in the same order. Written by the directory sync.';
