-- Memoized answers for /api/ask
-- Keyed by sha-256 of the lowercased/trimmed question. Caches the public response
-- payload (answer + sources + relatedVideos). Skipped when the request has chat history.

create table if not exists ask_cache (
  question_hash text primary key,
  question text not null,
  response jsonb not null,
  hit_count integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ask_cache_created_at_idx
  on ask_cache (created_at);

-- Service role only; the API uses SUPABASE_SERVICE_KEY
alter table ask_cache enable row level security;
