-- RLS policies for newsletter_subscribers
-- Service role (used by API) bypasses RLS automatically — no policy needed for inserts
-- Authenticated users (Supabase dashboard) can read subscribers
-- Anon/public cannot access the table at all

create policy "Authenticated users can read subscribers"
  on newsletter_subscribers
  for select
  to authenticated
  using (true);
