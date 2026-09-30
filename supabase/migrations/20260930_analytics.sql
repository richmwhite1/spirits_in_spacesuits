-- Site analytics: a first-party, cookie-free event log + a log of every "Ask Seán"
-- query, plus one RPC that returns the entire admin dashboard payload in a single
-- round trip (the dashboard is read often; the corpus/home endpoints showed that
-- N small queries from an edge function is the expensive shape).
--
-- Privacy: `visitor` is a salted hash of IP + user-agent that rotates every UTC day.
-- It cannot be reversed to an IP and cannot link a person across two days, so
-- "visitors" over a multi-day window means distinct visitor-days (the same
-- definition Plausible/Fathom use). No cookies, no cross-site identifiers.

create table if not exists analytics_events (
  id         bigserial primary key,
  event      text not null,          -- pageview | section | video | outbound | download | subscribe | testimonial
  label      text,                   -- section id, YouTube id, host+path, filename …
  path       text,
  referrer   text,                   -- referring host only, or 'direct'
  device     text,                   -- mobile | tablet | desktop
  country    text,                   -- ISO-3166 alpha-2 from the Vercel edge
  visitor    text,                   -- daily-rotating salted hash (see above)
  session    text,                   -- random per-tab id, client-generated
  created_at timestamptz not null default now()
);

create index if not exists analytics_events_created_at_idx
  on analytics_events (created_at desc);
create index if not exists analytics_events_event_created_idx
  on analytics_events (event, created_at desc);

-- Service role only; /api/track writes with SUPABASE_SERVICE_KEY
alter table analytics_events enable row level security;
grant all on analytics_events to service_role;
grant usage, select on sequence analytics_events_id_seq to service_role;

-- Every question put to the AI. Kept separately from analytics_events because the
-- interesting columns (was it answered, how many sources, how slow) are per-question,
-- and because "what are people actually asking?" is the highest-value read here.
-- Question text is already stored in ask_cache, so this is no new exposure.
create table if not exists ask_log (
  id           bigserial primary key,
  question     text not null,
  answered     boolean not null default true,   -- false = no passage cleared the similarity floor
  cached       boolean not null default false,  -- served from ask_cache, no Gemini call
  source_count integer not null default 0,
  top_score    integer,                         -- best similarity, 0-100
  latency_ms   integer,
  follow_up    boolean not null default false,  -- had conversation history
  visitor      text,
  country      text,
  created_at   timestamptz not null default now()
);

create index if not exists ask_log_created_at_idx on ask_log (created_at desc);

alter table ask_log enable row level security;
grant all on ask_log to service_role;
grant usage, select on sequence ask_log_id_seq to service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- analytics_summary(days) — the whole dashboard in one jsonb payload.
-- Compared against the immediately preceding window of the same length so the
-- admin sees direction, not just level.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function analytics_summary(p_days int default 30)
returns jsonb
language sql
stable
as $$
with w as (
  select
    d                                      as days,
    now() - make_interval(days => d)       as t0,
    now() - make_interval(days => d * 2)   as t_prev
  from (select greatest(least(coalesce(p_days, 30), 365), 1) as d) x
),
ev      as (select e.* from analytics_events e, w where e.created_at >= w.t0),
ev_prev as (select e.* from analytics_events e, w where e.created_at >= w.t_prev and e.created_at < w.t0),
ql      as (select a.* from ask_log a, w where a.created_at >= w.t0),
ql_prev as (select a.* from ask_log a, w where a.created_at >= w.t_prev and a.created_at < w.t0),
cal as (
  select generate_series(
           current_date - ((select days from w) - 1),
           current_date,
           interval '1 day'
         )::date as d
),
pv_day as (
  select created_at::date as d, count(*) as views, count(distinct visitor) as visitors
  from ev where event = 'pageview' group by 1
),
q_day as (
  select created_at::date as d, count(*) as n from ql group by 1
)
select jsonb_build_object(
  'days',         (select days from w),
  'generated_at', now(),

  'totals', jsonb_build_object(
    'visitors',          (select count(distinct visitor) from ev where event = 'pageview'),
    'pageviews',         (select count(*) from ev where event = 'pageview'),
    'sessions',          (select count(distinct session) from ev where session is not null),
    'questions',         (select count(*) from ql),
    'askers',            (select count(distinct visitor) from ql where visitor is not null),
    'subscribers_total', (select count(*) from newsletter_subscribers),
    'subscribers_new',   (select count(*) from newsletter_subscribers s, w where s.created_at >= w.t0),
    'testimonials_new',  (select count(*) from testimonials t, w where t.created_at >= w.t0)
  ),

  'previous', jsonb_build_object(
    'visitors',        (select count(distinct visitor) from ev_prev where event = 'pageview'),
    'pageviews',       (select count(*) from ev_prev where event = 'pageview'),
    'questions',       (select count(*) from ql_prev),
    'subscribers_new', (select count(*) from newsletter_subscribers s, w
                        where s.created_at >= w.t_prev and s.created_at < w.t0)
  ),

  -- Zero-filled so the trend line has no phantom gaps on quiet days
  'daily', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'date',      cal.d,
             'visitors',  coalesce(pv.visitors, 0),
             'pageviews', coalesce(pv.views, 0),
             'questions', coalesce(qd.n, 0)
           ) order by cal.d), '[]'::jsonb)
    from cal
    left join pv_day pv on pv.d = cal.d
    left join q_day  qd on qd.d = cal.d
  ),

  'ask', jsonb_build_object(
    'total',          (select count(*) from ql),
    'cached',         (select count(*) from ql where cached),
    'unanswered',     (select count(*) from ql where not answered),
    'follow_ups',     (select count(*) from ql where follow_up),
    -- Median, not mean: one cold start would drag an average somewhere useless
    'median_latency_ms', (select round(percentile_cont(0.5) within group (order by latency_ms))
                          from ql where latency_ms is not null and not cached),
    'avg_sources',    (select round(avg(source_count)::numeric, 1) from ql),
    'avg_score',      (select round(avg(top_score)) from ql where top_score is not null)
  ),

  'top_questions', (
    select coalesce(jsonb_agg(to_jsonb(t) order by t.n desc, t.question), '[]'::jsonb)
    from (
      select min(question) as question,
             count(*)      as n,
             count(*) filter (where not answered) as misses,
             max(created_at) as last_asked
      from ql group by lower(btrim(question))
      order by 2 desc limit 25
    ) t
  ),

  -- Questions the corpus could not answer: the content-gap list
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
      from ev where event = 'pageview'
      group by 1 order by 2 desc limit 15
    ) t
  ),

  'devices', (
    select coalesce(jsonb_agg(to_jsonb(t) order by t.n desc), '[]'::jsonb)
    from (
      select coalesce(device, 'unknown') as label, count(distinct visitor) as n
      from ev where event = 'pageview'
      group by 1 order by 2 desc
    ) t
  ),

  'countries', (
    select coalesce(jsonb_agg(to_jsonb(t) order by t.n desc), '[]'::jsonb)
    from (
      select coalesce(country, 'unknown') as label, count(distinct visitor) as n
      from ev where event = 'pageview'
      group by 1 order by 2 desc limit 15
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

  -- How much of the page a visit actually covers — depth, not just arrival
  'depth', jsonb_build_object(
    'sections_per_session', (
      select round(avg(c)::numeric, 1) from (
        select session, count(distinct label) as c
        from ev where event = 'section' and session is not null
        group by session
      ) s
    ),
    'sessions_reaching_ask', (
      select count(distinct session) from ev where event = 'section' and label = 'ask'
    )
  )
)
$$;

grant execute on function analytics_summary(int) to service_role;

notify pgrst, 'reload schema';
