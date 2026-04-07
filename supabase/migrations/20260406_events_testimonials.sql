-- Events: admin-managed, publicly listed
create table if not exists events (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  event_date  date not null,
  event_time  text,
  location    text,
  description text,
  link        text,
  created_at  timestamptz default now()
);

-- Testimonials: public submission, admin-moderated
create table if not exists testimonials (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  location    text,
  message     text not null,
  approved    boolean not null default false,
  created_at  timestamptz default now()
);
