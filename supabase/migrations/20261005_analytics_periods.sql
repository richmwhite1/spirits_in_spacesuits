-- Calendar-period filters for the analytics dashboard.
--
-- Replaces the rolling "last N days" window with today / this week / this month /
-- this year / all time, which is how the numbers actually get read ("how did
-- September go?" rather than "how did the last 30 days go?").
--
-- Two things make calendar periods behave:
--
-- 1. The comparison is like-for-like. On the 3rd of the month, "this month" is
--    three days of data; comparing it to the whole of last month would show a
--    90% collapse every month. So the previous window is the same elapsed span
--    measured from the start of the previous period — month-to-date vs the same
--    stretch of last month. "All time" has nothing to compare against and
--    returns previous = null, which the UI reads as "hide the deltas".
--
-- 2. The chart bucket follows the span, not the period name. "This year" on
--    January 3rd is three days long and wants daily points, not one monthly
--    one; all time wants months once it outgrows a quarter.
--
-- The older analytics_summary(int) is left in place so a deployment that still
-- calls ?days=30 keeps working through the rollout. It is safe to drop once the
-- period-based dashboard is live.

create or replace function analytics_summary(p_period text default 'month')
returns jsonb
language sql
stable
as $$
with
per as (
  select case lower(coalesce(p_period, 'month'))
           when 'today' then 'today'
           when 'day'   then 'today'
           when 'week'  then 'week'
           when 'month' then 'month'
           when 'year'  then 'year'
           when 'all'   then 'all'
           else 'month'
         end as p
),
start_at as (
  select p,
         case p
           when 'today' then date_trunc('day',   now())
           when 'week'  then date_trunc('week',  now())
           when 'month' then date_trunc('month', now())
           when 'year'  then date_trunc('year',  now())
           -- All time starts at the first thing ever recorded, in either table
           else coalesce(
                  least(
                    (select min(created_at) from analytics_events),
                    (select min(created_at) from ask_log)
                  ),
                  date_trunc('day', now())
                )
         end as t0
  from per
),
w as (
  select
    p,
    t0,
    now()     as t1,
    now() - t0 as span,
    case p
      when 'today' then date_trunc('day',   now()) - interval '1 day'
      when 'week'  then date_trunc('week',  now()) - interval '7 days'
      when 'month' then date_trunc('month', now()) - interval '1 month'
      when 'year'  then date_trunc('year',  now()) - interval '1 year'
      else null
    end as prev0,
    case
      when now() - t0 <= interval '2 days'  then 'hour'
      when now() - t0 <= interval '92 days' then 'day'
      else 'month'
    end as bucket
  from start_at
),
b as (
  select *, case when prev0 is null then null else prev0 + span end as prev1 from w
),
ev      as (select e.* from analytics_events e, b where e.created_at >= b.t0),
ev_prev as (select e.* from analytics_events e, b
            where b.prev0 is not null and e.created_at >= b.prev0 and e.created_at < b.prev1),
ql      as (select a.* from ask_log a, b where a.created_at >= b.t0),
ql_prev as (select a.* from ask_log a, b
            where b.prev0 is not null and a.created_at >= b.prev0 and a.created_at < b.prev1),
cal as (
  select generate_series(
           date_trunc((select bucket from b), (select t0 from b)),
           date_trunc((select bucket from b), (select t1 from b)),
           ('1 ' || (select bucket from b))::interval
         ) as slot
),
pv_slot as (
  select date_trunc((select bucket from b), created_at) as slot,
         count(*) as views, count(distinct visitor) as visitors
  from ev where event = 'pageview' group by 1
),
q_slot as (
  select date_trunc((select bucket from b), created_at) as slot, count(*) as n
  from ql group by 1
)
select jsonb_build_object(
  'period',       (select p from b),
  'period_start', (select t0 from b),
  'period_end',   (select t1 from b),
  'prev_start',   (select prev0 from b),
  'prev_end',     (select prev1 from b),
  'bucket',       (select bucket from b),
  'generated_at', now(),

  'totals', jsonb_build_object(
    'visitors',          (select count(distinct visitor) from ev where event = 'pageview'),
    'pageviews',         (select count(*) from ev where event = 'pageview'),
    'sessions',          (select count(distinct session) from ev where session is not null),
    'questions',         (select count(*) from ql),
    'askers',            (select count(distinct visitor) from ql where visitor is not null),
    'subscribers_total', (select count(*) from newsletter_subscribers),
    -- Subscribers and testimonials predate analytics, so "all time" means the
    -- whole table rather than "since we started counting page views"
    'subscribers_new',   (select count(*) from newsletter_subscribers s, b
                          where s.created_at >= (case when b.p = 'all' then '-infinity'::timestamptz else b.t0 end)),
    'testimonials_new',  (select count(*) from testimonials t, b
                          where t.created_at >= (case when b.p = 'all' then '-infinity'::timestamptz else b.t0 end))
  ),

  -- null for all time — the UI hides every delta rather than inventing one
  'previous', (
    select case when b.prev0 is null then null else jsonb_build_object(
      'visitors',        (select count(distinct visitor) from ev_prev where event = 'pageview'),
      'pageviews',       (select count(*) from ev_prev where event = 'pageview'),
      'questions',       (select count(*) from ql_prev),
      'subscribers_new', (select count(*) from newsletter_subscribers s
                          where s.created_at >= b.prev0 and s.created_at < b.prev1)
    ) end from b
  ),

  'series', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'at',        cal.slot,
             'visitors',  coalesce(pv.visitors, 0),
             'pageviews', coalesce(pv.views, 0),
             'questions', coalesce(qs.n, 0)
           ) order by cal.slot), '[]'::jsonb)
    from cal
    left join pv_slot pv on pv.slot = cal.slot
    left join q_slot  qs on qs.slot = cal.slot
  ),

  'ask', jsonb_build_object(
    'total',      (select count(*) from ql),
    'cached',     (select count(*) from ql where cached),
    'unanswered', (select count(*) from ql where not answered),
    'follow_ups', (select count(*) from ql where follow_up),
    'median_latency_ms', (select round(percentile_cont(0.5) within group (order by latency_ms))
                          from ql where latency_ms is not null and not cached),
    'avg_sources', (select round(avg(source_count)::numeric, 1) from ql),
    'avg_score',   (select round(avg(top_score)) from ql where top_score is not null)
  ),

  'top_questions', (
    select coalesce(jsonb_agg(to_jsonb(t) order by t.n desc, t.question), '[]'::jsonb)
    from (
      select min(question) as question, count(*) as n,
             count(*) filter (where not answered) as misses,
             max(created_at) as last_asked
      from ql group by lower(btrim(question)) order by 2 desc limit 25
    ) t
  ),

  'gaps', (
    select coalesce(jsonb_agg(to_jsonb(t) order by t.n desc, t.question), '[]'::jsonb)
    from (
      select min(question) as question, count(*) as n, max(created_at) as last_asked
      from ql where not answered group by lower(btrim(question))
      order by 2 desc limit 20
    ) t
  ),

  'recent_questions', (
    select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb)
    from (
      select question, answered, cached, source_count, top_score, country, created_at
      from ql order by created_at desc limit 40
    ) t
  ),

  'sections', (
    select coalesce(jsonb_agg(to_jsonb(t) order by t.n desc), '[]'::jsonb)
    from (
      select label, count(*) as n, count(distinct visitor) as uniques
      from ev where event = 'section' and label is not null
      group by label order by 2 desc limit 30
    ) t
  ),

  'referrers', (
    select coalesce(jsonb_agg(to_jsonb(t) order by t.n desc), '[]'::jsonb)
    from (
      select coalesce(referrer, 'direct') as label, count(*) as n
      from ev where event = 'pageview' group by 1 order by 2 desc limit 15
    ) t
  ),

  'devices', (
    select coalesce(jsonb_agg(to_jsonb(t) order by t.n desc), '[]'::jsonb)
    from (
      select coalesce(device, 'unknown') as label, count(distinct visitor) as n
      from ev where event = 'pageview' group by 1 order by 2 desc
    ) t
  ),

  'countries', (
    select coalesce(jsonb_agg(to_jsonb(t) order by t.n desc), '[]'::jsonb)
    from (
      select coalesce(country, 'unknown') as label, count(distinct visitor) as n
      from ev where event = 'pageview' group by 1 order by 2 desc limit 15
    ) t
  ),

  'videos', (
    select coalesce(jsonb_agg(to_jsonb(t) order by t.n desc), '[]'::jsonb)
    from (
      select label, count(*) as n from ev where event = 'video' and label is not null
      group by label order by 2 desc limit 15
    ) t
  ),

  'outbound', (
    select coalesce(jsonb_agg(to_jsonb(t) order by t.n desc), '[]'::jsonb)
    from (
      select label, count(*) as n from ev where event = 'outbound' and label is not null
      group by label order by 2 desc limit 15
    ) t
  ),

  'downloads', (
    select coalesce(jsonb_agg(to_jsonb(t) order by t.n desc), '[]'::jsonb)
    from (
      select label, count(*) as n from ev where event = 'download' and label is not null
      group by label order by 2 desc limit 15
    ) t
  ),

  'hours', (
    select coalesce(jsonb_agg(to_jsonb(t) order by t.hour), '[]'::jsonb)
    from (
      select extract(hour from created_at)::int as hour, count(*) as n
      from ev where event = 'pageview' group by 1
    ) t
  ),

  'depth', jsonb_build_object(
    'sections_per_session', (
      select round(avg(c)::numeric, 1) from (
        select session, count(distinct label) as c
        from ev where event = 'section' and session is not null group by session
      ) s
    ),
    'sessions_reaching_ask', (
      select count(distinct session) from ev where event = 'section' and label = 'ask'
    )
  )
)
$$;

grant execute on function analytics_summary(text) to service_role;

notify pgrst, 'reload schema';
