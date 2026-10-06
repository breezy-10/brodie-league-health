-- Staff performance ratings, 0 to 10, set by admins and district managers on
-- the Staff performance page. The staff themselves live in the Training app and
-- are read from it live; a rating is keyed by Training's users.id, with the
-- email kept so it still reads if that account is ever recreated.
--
-- Every change is a new row, which keeps the history of who rated whom and
-- when. The page shows each person's latest through staff_ratings_latest.
--
-- RLS is on with no policies: only the service role reads or writes, and the
-- page's server code is what checks the viewer is an admin or district manager.
create table if not exists staff_ratings (
  id               uuid primary key default gen_random_uuid(),
  training_user_id uuid not null,
  staff_email      text not null,
  rating           smallint not null check (rating between 0 and 10),
  rated_by         uuid references profiles(id) on delete set null,
  rated_by_name    text,
  created_at       timestamptz not null default now()
);

create index if not exists staff_ratings_person_idx
  on staff_ratings (training_user_id, created_at desc);

alter table staff_ratings enable row level security;
revoke all on staff_ratings from anon, authenticated;

create or replace view staff_ratings_latest with (security_invoker = true) as
  select distinct on (training_user_id)
         training_user_id, staff_email, rating, rated_by, rated_by_name, created_at
    from staff_ratings
   order by training_user_id, created_at desc;

revoke all on staff_ratings_latest from anon, authenticated;
