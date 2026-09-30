-- Reverts 20260929_featured_videos.sql.
--
-- "Latest from Seán" is deliberately a pure feed of Seán's own YouTube channel
-- via /api/videos. A YouTube video of his that lives on someone else's channel
-- belongs in Podcast Appearances (the `podcasts` table), which already has an
-- admin page and its own section on the homepage. A second admin surface for
-- off-channel videos was a confusing duplicate, so it and this table are gone.
--
-- No data is lost: the one seeded row (Guy Lawrence, UneGhnKln08) already
-- exists in `podcasts`.
drop table if exists featured_videos;

-- Reload PostgREST schema cache
notify pgrst, 'reload schema';
