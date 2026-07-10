-- corpus_sources(): aggregated source list for the admin panel.
-- Replaces client-side pagination over the whole sean_chunks table
-- (N x 1000-row fetches) with a single GROUP BY done in Postgres.

create or replace function corpus_sources()
returns table (
  source_type text,
  source_title text,
  source_id text,
  chunk_count bigint
)
language sql stable as $$
  select
    source_type,
    source_title,
    min(source_id) as source_id,
    count(*) as chunk_count
  from sean_chunks
  group by source_type, source_title
  order by source_type, source_title;
$$;
