-- Per-season referral program terms: what the referrer is paid and what the
-- referred athlete gets off their registration.
--
-- Keyed by season name (the registration season, e.g. "Fall '26") because the
-- terms change season to season — a promo run for one season must not rewrite
-- what a past season actually cost. A season with no row falls back to the
-- app's defaults ($25 / $5 / $0), so a new season needs no seeding.
--
-- Amounts are nominal: the same figure applies in each location's own currency
-- (a US venue pays USD, a Canadian one CAD), matching how ops records
-- fin_referrals_registrations.earned_amount. Nothing here is converted.
create table if not exists referral_rates (
  season                    text primary key,
  new_athlete_payment       numeric(10,2) not null default 25 check (new_athlete_payment >= 0),
  returning_athlete_payment numeric(10,2) not null default 5  check (returning_athlete_payment >= 0),
  registrant_discount       numeric(10,2) not null default 0  check (registrant_discount >= 0),
  updated_at                timestamptz not null default now(),
  updated_by                uuid references auth.users(id)
);

alter table referral_rates enable row level security;

-- Everyone signed in can read the terms (they drive the numbers on the page);
-- only dm / super_admin can change them, matching apps + metrics.
create policy referral_rates_read on referral_rates for select to authenticated
  using (true);
create policy referral_rates_write on referral_rates for all to authenticated
  using (current_role_for_user() in ('dm', 'super_admin'))
  with check (current_role_for_user() in ('dm', 'super_admin'));
