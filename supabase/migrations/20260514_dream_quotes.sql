-- Dream Quotes: admin-managed, publicly listed
create table if not exists dream_quotes (
  id          uuid primary key default gen_random_uuid(),
  quote       text not null,
  sort_order  integer not null default 0,
  created_at  timestamptz default now()
);
