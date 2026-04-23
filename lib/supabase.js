// Supabase vector search helpers
// Run the SQL below once in your Supabase SQL editor to set up the schema

/*
──────────────────────────────────────────────
SUPABASE SETUP SQL — run this once
──────────────────────────────────────────────

-- Enable vector extension
create extension if not exists vector;

-- Main corpus table: all chunks from transcripts and books
create table sean_chunks (
  id          bigserial primary key,
  content     text not null,
  embedding   vector(768),     -- Gemini text-embedding-004 = 768 dims
  source_type text not null,   -- 'transcript' | 'book'
  source_title text not null,  -- Video title or book title
  source_id   text,            -- YouTube video ID (for transcripts)
  source_date text,            -- Date string e.g. "2024-03-15"
  chunk_index int default 0
);

-- Fast approximate nearest-neighbor index
create index on sean_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- Rate limiting table
create table rate_limits (
  ip    text not null,
  date  date not null default current_date,
  count integer not null default 0,
  primary key (ip, date)
);

-- Auto-cleanup rate limits older than 7 days (keeps table small)
create or replace function cleanup_old_rate_limits() returns void as $$
  delete from rate_limits where date < current_date - interval '7 days';
$$ language sql;

-- Increment function for atomic rate limit updates
create or replace function increment_rate_limit(p_ip text, p_date date)
returns integer as $$
declare
  new_count integer;
begin
  insert into rate_limits (ip, date, count)
  values (p_ip, p_date, 1)
  on conflict (ip, date)
  do update set count = rate_limits.count + 1
  returning count into new_count;
  return new_count;
end;
$$ language plpgsql;

-- Semantic search function — finds most relevant chunks
create or replace function match_chunks(
  query_embedding vector(768),
  match_count int default 8,
  source_filter text default null
)
returns table (
  id bigint,
  content text,
  source_type text,
  source_title text,
  source_id text,
  source_date text,
  similarity float
)
language sql stable as $$
  select
    id, content, source_type, source_title, source_id, source_date,
    1 - (embedding <=> query_embedding) as similarity
  from sean_chunks
  where
    source_filter is null or source_type = source_filter
  order by embedding <=> query_embedding
  limit match_count;
$$;

-- Events (admin-managed, publicly listed)
create table events (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  event_date  date not null,
  event_time  text,
  location    text,
  description text,
  link        text,
  created_at  timestamptz default now()
);

-- Testimonials (public submission, admin-moderated)
create table testimonials (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  location    text,
  message     text not null,
  approved    boolean not null default false,
  created_at  timestamptz default now()
);

-- Books (admin-managed, publicly listed)
create table books (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  subtitle    text,
  badge_text  text,
  description text,
  cover_url   text,
  links       jsonb not null default '[]',  -- [{label: "Amazon", url: "https://..."}]
  sort_order  integer not null default 0,
  created_at  timestamptz default now()
);

-- Glossary terms (admin-managed, publicly listed)
create table glossary (
  id          uuid primary key default gen_random_uuid(),
  term        text not null,
  definition  text not null,
  created_at  timestamptz default now()
);

-- Courses (admin-managed, publicly listed)
create table courses (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  subtitle    text,
  description text,
  image_url   text,
  link        text,
  status      text not null default 'coming_soon',  -- 'coming_soon' | 'available' | 'in_progress'
  sort_order  integer not null default 0,
  created_at  timestamptz default now()
);

-- Seed existing books (run after creating the table)
-- Copy the INSERT statements from data/seed-books.sql

──────────────────────────────────────────────
*/

import { createClient } from '@supabase/supabase-js';

let _supabase = null;

export function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );
  }
  return _supabase;
}

// Find the most semantically relevant chunks for a query
export async function findRelevantChunks(queryEmbedding, count = 8) {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('match_chunks', {
    query_embedding: queryEmbedding,
    match_count: count
  });

  if (error) throw new Error(`Vector search failed: ${error.message}`);
  return data || [];
}

// Insert a batch of chunks with their embeddings
export async function insertChunks(chunks) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('sean_chunks')
    .insert(chunks);

  if (error) throw new Error(`Insert failed: ${error.message}`);
}
