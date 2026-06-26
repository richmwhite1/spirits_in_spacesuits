-- Podcasts: Seán's guest appearances on other people's shows.
-- Admin-managed (manual add/edit), publicly listed. Distinct from his own
-- YouTube channel feed (served by /api/videos) — these are external podcasts
-- where he was a guest. Seeded from "Podcasts for Richard.xlsx".
create table if not exists podcasts (
  id               uuid primary key default gen_random_uuid(),
  host             text not null,          -- show or host name (spreadsheet col A)
  title            text not null,          -- episode title / topic (col B)
  youtube_url      text not null,          -- original link as supplied (col E)
  video_id         text,                   -- extracted YouTube id for thumbnail + embed
  aired_date       date,                   -- when it aired (col C)
  duration_seconds integer,                -- running time (col D)
  sort_order       integer not null default 0,
  created_at       timestamptz default now()
);

-- Permissions
grant select on podcasts to anon, authenticated;
grant all on podcasts to service_role;

-- RLS: public read, service_role writes via API
alter table podcasts enable row level security;
create policy "Public can read podcasts"
  on podcasts for select to anon, authenticated using (true);

-- Seed from the supplied spreadsheet (only when table is empty)
insert into podcasts (host, title, aired_date, duration_seconds, youtube_url, video_id)
select host, title, aired_date::date, duration_seconds::integer, youtube_url, video_id
from (values
  ('Pat Byrnes', 'We are one', '2004-04-04', 3575, 'https://youtu.be/MAe0P5kY3-w?si=b8AHOO2utyQHAdPI', 'MAe0P5kY3-w'),
  ('East West Bookstore', 'A Sensible God', '2009-04-01', 260, 'https://youtu.be/H_VJTeLpY4Q?si=hPa0mH5Sf5zW-ZHC', 'H_VJTeLpY4Q'),
  ('Still ''N Motion', 'Seán Ólaoire', '2011-06-26', 58, 'https://youtu.be/cVkiEhmtnnI?si=bE5MZP1qOZYfCiYt', 'cVkiEhmtnnI'),
  ('Why? Matt and Seán', 'Why?', '2013-04-11', 678, 'https://youtu.be/HLyewvM2jPE?si=xXKqDSz7CMMfz9Ed', 'HLyewvM2jPE'),
  ('Celtic Spirituality', 'Celtic Spirituality', '2016-01-05', 2470, 'https://youtu.be/-XRyU5h9uzQ?si=HK_yGPdSL4X_EPFQ', '-XRyU5h9uzQ'),
  ('Eucharistic Prayer of the Cosmos', 'Liturgy', '2016-11-29', 807, 'https://youtu.be/ffp7BdN2fIw?si=3cpxFQRmCIQesTmF', 'ffp7BdN2fIw'),
  ('Mark Allan Kaplan', 'On the experience of divine guidance', '2021-01-31', 3476, 'https://youtu.be/krzSV7EQv5Q?si=l1LxSB77rBguHADQ', 'krzSV7EQv5Q'),
  ('Spirit House', 'Setting God Free', '2021-11-19', 7451, 'https://youtu.be/yJaqLI03Apg?si=7XUdVpyfS3XnT8iy', 'yJaqLI03Apg'),
  ('Regina Meredith', 'Meet the Druid', '2021-11-30', 3053, 'https://youtu.be/mC-yB3rR4ns?si=2xwnuB-pRL8nb0Rp', 'mC-yB3rR4ns'),
  ('Vibrational Revelation', 'Spirits in Spacesuits', '2021-12-22', 4632, 'https://youtu.be/cQ8ttSdCqp4?si=mzoyimZfHqChMJMc', 'cQ8ttSdCqp4'),
  ('Paul O''Rourke', 'Community and Spirituality', '2022-01-12', 1455, 'https://youtu.be/2PEgJwqmBiY?si=Pif1sPK81vo2GdNL', '2PEgJwqmBiY'),
  ('Regina Meredith', 'Why Am I Here?', '2022-04-12', 3155, 'https://youtu.be/Yx6FG4-XJ-s?si=EelrxRzMPIKhfBbq', 'Yx6FG4-XJ-s'),
  ('Nigel McFarland', 'Poet, Storyteller, Priest…', '2022-05-09', 4041, 'https://www.youtube.com/live/LamFfxvTwZg?si=yN8OEBdWns4utlB2', 'LamFfxvTwZg'),
  ('Regina Meredith', 'How to be a spiritual opportunist', '2022-05-18', 376, 'https://youtu.be/yWQRtZvPyHo?si=8TJxDVEO4ti4gm04', 'yWQRtZvPyHo'),
  ('PA ITP', 'Why did I come to planet Earth?', '2022-06-24', 5272, 'https://youtu.be/1boO1_-QPoQ?si=_7hbqiyB5U0L-AVq', '1boO1_-QPoQ'),
  ('Paul Chek', 'Setting God Free', '2022-10-04', 10824, 'https://youtu.be/uinXWo6fGgI?si=OgoUMhfGCxKduQp9', 'uinXWo6fGgI'),
  ('Carr-Gomm Part 1', 'Explaining Druidry and Christianity', '2023-01-22', 3781, 'https://youtu.be/5WTsUXy8b2A?si=DwiI2gDb0g_ZJYaq', '5WTsUXy8b2A'),
  ('Buddha at the Gas Pump', 'A priest who believes in Reincarnation', '2023-02-25', 8029, 'https://youtu.be/CAEUqVnde1k?si=J7o1_BHRnAHEbT5P', 'CAEUqVnde1k'),
  ('Perspective Shift', 'Setting God Free', '2023-05-22', 7767, 'https://youtu.be/BFPedY39b9s?si=r2tqrJ0126Crovpi', 'BFPedY39b9s'),
  ('Ten Million for Peace', 'Shifting your consciousness', '2023-09-01', 1357, 'https://youtu.be/jqqFGA1wKUY?si=6oYt4l4XA2pFwUwV', 'jqqFGA1wKUY'),
  ('Kyle Kingsbury', 'Higher versions of the Self', '2023-09-18', 4487, 'https://youtu.be/33ZqU5hEfls?si=eaX6QtTA9CGi8Xo-', '33ZqU5hEfls'),
  ('Awakening Aphrodite', 'Science, Spirituality and Psychology', '2023-11-07', 5668, 'https://youtu.be/chUWHM1jdDI?si=hCYBifTvLiQfiuR4', 'chUWHM1jdDI'),
  ('Carr-Gomm - Part 2', 'Exploring Druidry and Christianity', '2024-02-14', 3177, 'https://youtu.be/HCG-4zhx864?si=YfhJ6jF0wvLRefjb', 'HCG-4zhx864'),
  ('Paul Chek', 'Rise, Spiritual Warriors - Snippet', '2024-02-17', 204, 'https://youtu.be/4vwx4L7oygE?si=vNDhCpsVz0I-6H2w', '4vwx4L7oygE'),
  ('Paul Chek', 'Rise, Spiritual Warriors', null, 7557, 'https://youtu.be/6ZLUTf4E8ko?si=KOLIf0gzrCcJNcQJ', '6ZLUTf4E8ko'),
  ('Next Level Soul', 'Jesus'' Lost years', '2024-05-07', 5541, 'https://youtu.be/mBAPVOayL74?si=BjhW8gOxuLS-iVLw', 'mBAPVOayL74'),
  ('Ana Otero', 'Mystical Pathways with Fr. Seán', '2024-05-29', 3635, 'https://youtu.be/qGsU9xVzKI0?si=gRDEPfnRhq9u6QBZ', 'qGsU9xVzKI0'),
  ('Broader Lens', 'Setting God Free', '2024-07-08', 4383, 'https://youtu.be/zcrtYE6I74A?si=KycPux0Io2ugErm9', 'zcrtYE6I74A'),
  ('Sedgbeer', 'No BS Bookclub and Seán', '2024-09-26', 4050, 'https://www.youtube.com/live/8UcLCx-ry8o?si=ITWK-7lumyOdzKSh', '8UcLCx-ry8o'),
  ('Sedgbeer', 'Debunking the Bible + Wallis', '2024-10-10', 5546, 'https://youtu.be/WVex3kG6r-U?si=801uV7iceq583lYe', 'WVex3kG6r-U'),
  ('Aubry Marcus', 'Catholic priest on Evil, reincarnation…', '2024-10-29', 7801, 'https://youtu.be/BAzP3Q51s8w?si=gd5Z9eimb01rnjNP', 'BAzP3Q51s8w'),
  ('The Sacred Rainbow', 'A Feminine Face of God', '2024-12-18', 2978, 'https://youtu.be/HsASWwMv6nU?si=jE-RjhLD7ZWU8miQ', 'HsASWwMv6nU'),
  ('Aubry Marcus', 'King Arthur, Jesus, the sword…', '2024-12-18', 6262, 'https://youtu.be/Q1RM4Pyar2E?si=bLjOm7JlJfbmxci7', 'Q1RM4Pyar2E'),
  ('Amrit Sandhu', 'Jesus, Reincarnation and Mysticism', '2025-01-08', 6578, 'https://youtu.be/GIVUTKkLqEI?si=WhHJpRqb65pw9dZ1', 'GIVUTKkLqEI'),
  ('Paul Chek', 'Finding self and soul today', '2025-02-08', 7016, 'https://youtu.be/1OJVUxYNL0o?si=eys5aTn-bTUJUrQb', '1OJVUxYNL0o'),
  ('The Weekend University', 'Shadow work, Christ Consciousness', '2025-02-20', 3621, 'https://youtu.be/ZJPecLW1OHU?si=4pXcrtyv0jh9c84e', 'ZJPecLW1OHU'),
  ('The Spiritual Psychiatrist', 'Myth, Christ Consciousness', '2025-04-16', 6003, 'https://youtu.be/SaCRexdAzxg?si=txkcCpGRGDhSWo67', 'SaCRexdAzxg'),
  ('Behind Greatness', 'Death, the Vatican, Druids', '2025-05-06', 4086, 'https://youtu.be/exYYJXWMnwY?si=x9ZCp7dIisv33fAV', 'exYYJXWMnwY'),
  ('Dr Espen', 'Spiritual awakening through community', '2025-05-20', 5045, 'https://youtu.be/yk9XALyBNbI?si=uYSoaZlm2qNLcv5A', 'yk9XALyBNbI'),
  ('Savej', 'A mystic''s guide to God', '2025-10-15', 5950, 'https://youtu.be/S1ESbBMgwlU?si=SQ7AJFNFvVc-Yobg', 'S1ESbBMgwlU'),
  ('Paul Chek', 'From Dust to Divinity', '2025-11-27', 9395, 'https://youtu.be/F38GcOrFM0E?si=h1ot3s5RS4vNghLE', 'F38GcOrFM0E'),
  ('Wallis/Sedgbeer', 'Debunking the Bible', '2025-12-04', 5546, 'https://youtu.be/WVex3kG6r-U?si=q817vbFe6HlGK5Vi', 'WVex3kG6r-U'),
  ('Aaron Abke - Awaken', 'Walking the Jesus Way', '2025-12-13', 3747, 'https://youtu.be/n3575oCycdY?si=4wMM1SDOt9GWQ2Zd', 'n3575oCycdY'),
  ('Sedgbeer - 10 best books', 'The Priest who wouldn''t stay silent', '2025-12-18', 4059, 'https://youtu.be/pOj73dAo2e4?si=Z7iwkjKmax1ukGph', 'pOj73dAo2e4'),
  ('Aubrey Marcus', 'The spiritual battle for humanity''s soul', '2026-02-07', 7454, 'https://youtu.be/eKRx8Wh-qeM?si=pRaLUJlYfBpls6Rg', 'eKRx8Wh-qeM'),
  ('Booboo Garcia', 'Christ Consciousness beyond religion', '2026-02-20', 5222, 'https://youtu.be/_kH557DxG70?si=ACvwi53DPV2fLEYR', '_kH557DxG70'),
  ('Paul Chek', 'The Parables of Jesus', '2026-04-21', 7375, 'https://youtu.be/U5EKIIXiFFI?si=8tWSvUoyZmY_5wDr', 'U5EKIIXiFFI'),
  ('Aubrey Marcus', 'Exorcisms', '2026-04-29', 7535, 'https://youtu.be/NyAnKmN2cP0?si=AEF-DBBov_qwm4ue', 'NyAnKmN2cP0'),
  ('Aubrey - second version', 'Spiritual battle for humanity', '2026-05-01', 7454, 'https://youtu.be/CeY-RheNO_s?si=xvn3s6RIa93kCSgi', 'CeY-RheNO_s'),
  ('Aeon Byte', 'Spirits in spacesuits - the search for God', '2026-05-21', 3763, 'https://www.youtube.com/watch?v=1H6baGbYFG4&t=1s', '1H6baGbYFG4'),
  ('Caritas Consciousness Project', 'Setting God Free', '2026-06-17', 6897, 'https://youtu.be/VKS7nYEZ93M?si=xj4UlXcbIfUzzoL8', 'VKS7nYEZ93M'),
  ('Next Level Soul - Alex Ferrari', 'Faith Deconstruction', '2026-06-23', 5632, 'https://youtu.be/_on7X3RyhlE?si=4EfSFfUVAy-qIC4V', '_on7X3RyhlE')
) as v(host, title, aired_date, duration_seconds, youtube_url, video_id)
where not exists (select 1 from podcasts);

-- Reload PostgREST schema cache
notify pgrst, 'reload schema';
