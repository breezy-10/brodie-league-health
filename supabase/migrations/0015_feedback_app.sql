-- 0015_feedback_app.sql
-- Register brodie-feedback as a source app. Pulls NPS survey responses from
-- the feedback Supabase (project qojmxikkvwtslfswkfna), aggregates per LM
-- based on the response's location, and creates follow-up action items for
-- any detractor (NPS < 7).
--
-- Two metrics:
--   feedback_detractor — per-unit penalty (-10 XP per detractor in last 14d)
--   feedback_promoter  — per-unit reward  (+5 XP per promoter in last 14d)
--
-- xp_floor on the app caps the negative side so a bad week doesn't tank
-- the whole score.

insert into apps (slug, name, weight, xp_floor, enabled)
values ('feedback', 'Player Feedback', 1.0, -30, true)
on conflict (slug) do update set
  name = excluded.name,
  weight = excluded.weight,
  xp_floor = excluded.xp_floor,
  enabled = excluded.enabled;

-- Detractor: -10 per response with NPS < 7 in the last 14 days
insert into metrics (app_id, slug, name, weight_within_app, direction, scoring_rule)
select id, 'feedback_detractor', 'NPS detractor', 1.0, 'down',
  '{"type":"per_unit_penalty","xp_per_unit":-10,"window_days":14}'::jsonb
from apps where slug = 'feedback'
on conflict (slug) do update set
  name = excluded.name,
  scoring_rule = excluded.scoring_rule;

-- Promoter: +5 per response with NPS 9-10 in the last 14 days
insert into metrics (app_id, slug, name, weight_within_app, direction, scoring_rule)
select id, 'feedback_promoter', 'NPS promoter', 1.0, 'up',
  '{"type":"per_unit","xp_per_unit":5,"window_days":14}'::jsonb
from apps where slug = 'feedback'
on conflict (slug) do update set
  name = excluded.name,
  scoring_rule = excluded.scoring_rule;
