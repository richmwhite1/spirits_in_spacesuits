-- Dream Quotes: admin-managed, publicly listed
create table if not exists dream_quotes (
  id          uuid primary key default gen_random_uuid(),
  quote       text not null,
  sort_order  integer not null default 0,
  created_at  timestamptz default now()
);

-- Permissions
grant select on dream_quotes to anon, authenticated;
grant all on dream_quotes to service_role;

-- RLS: public read, service_role writes via API
alter table dream_quotes enable row level security;
create policy "Public can read dream_quotes"
  on dream_quotes for select to anon, authenticated using (true);

-- Reload PostgREST schema cache
notify pgrst, 'reload schema';
