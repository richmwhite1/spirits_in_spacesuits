-- Featured videos: YouTube videos that are NOT on Seán's own channel but should
-- still surface in the "Latest from Seán" section of the homepage.
--
-- /api/videos only ever sees his channel's uploads playlist, so an interview or
-- talk posted on someone else's channel could never reach that section. Rows
-- here are merged into the Latest feed client-side: pinned rows first, then
-- everything (channel uploads + these) newest-first by date.
--
-- Admin-managed via the admin panel ("Latest from Seán" under Media).
create table if not exists featured_videos (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,          -- shown as the video title
  youtube_url  text not null,          -- original link as supplied
  video_id     text,                   -- extracted YouTube id for thumbnail + embed
  source       text,                   -- whose channel it was posted on, e.g. "Guy Lawrence"
  published_at date,                   -- date used to order the Latest feed
  pinned       boolean not null default false, -- force to the top of Latest from Seán
  sort_order   integer not null default 0,
  created_at   timestamptz default now()
);

create index if not exists featured_videos_order_idx
  on featured_videos (pinned desc, published_at desc nulls last, created_at desc);

-- Permissions
grant select on featured_videos to anon, authenticated;
grant all on featured_videos to service_role;

-- RLS: public read, service_role writes via the API
alter table featured_videos enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'featured_videos' and policyname = 'Public can read featured videos'
  ) then
    create policy "Public can read featured videos"
      on featured_videos for select to anon, authenticated using (true);
  end if;
end $$;

-- Seed: the Guy Lawrence conversation (added as a podcast appearance on
-- 2026-09-29, but it also needs to lead the Latest from Seán section).
insert into featured_videos (title, youtube_url, video_id, source, published_at, pinned)
select v.title, v.youtube_url, v.video_id, v.source, v.published_at::date, v.pinned
from (values
  (
    'Why Humanity''s Current Chaos May Be Part of a Spiritual Rebirth',
    'https://youtu.be/UneGhnKln08',
    'UneGhnKln08',
    'Guy Lawrence',
    '2026-09-22',
    true
  )
) as v(title, youtube_url, video_id, source, published_at, pinned)
where not exists (select 1 from featured_videos where video_id = v.video_id);

-- Reload PostgREST schema cache
notify pgrst, 'reload schema';
