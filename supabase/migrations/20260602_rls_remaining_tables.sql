-- Enable RLS on all public tables missing it (idempotent — safe to re-run)
-- All write operations use SUPABASE_SERVICE_KEY (service_role), which bypasses RLS

-- sean_chunks: AI search corpus, publicly readable
alter table sean_chunks enable row level security;
drop policy if exists "Public can read sean_chunks" on sean_chunks;
create policy "Public can read sean_chunks"
  on sean_chunks for select to anon, authenticated using (true);

-- rate_limits: server-side only, no public access
alter table rate_limits enable row level security;

-- books: publicly readable, admin writes via service_role
alter table books enable row level security;
drop policy if exists "Public can read books" on books;
create policy "Public can read books"
  on books for select to anon, authenticated using (true);

-- glossary: publicly readable, admin writes via service_role
alter table glossary enable row level security;
drop policy if exists "Public can read glossary" on glossary;
create policy "Public can read glossary"
  on glossary for select to anon, authenticated using (true);

-- courses: publicly readable, admin writes via service_role
alter table courses enable row level security;
drop policy if exists "Public can read courses" on courses;
create policy "Public can read courses"
  on courses for select to anon, authenticated using (true);

-- events: publicly readable, admin writes via service_role
alter table events enable row level security;
drop policy if exists "Public can read events" on events;
create policy "Public can read events"
  on events for select to anon, authenticated using (true);

-- testimonials: approved ones are publicly readable, submissions via service_role API
alter table testimonials enable row level security;
drop policy if exists "Public can read approved testimonials" on testimonials;
create policy "Public can read approved testimonials"
  on testimonials for select to anon, authenticated using (approved = true);

notify pgrst, 'reload schema';
