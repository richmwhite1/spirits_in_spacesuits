-- Newsletter subscribers: public signup, admin-visible only
create table if not exists newsletter_subscribers (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique,
  created_at timestamptz default now()
);

-- Admins can read all; no public read access
alter table newsletter_subscribers enable row level security;
