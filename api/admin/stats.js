// GET /api/admin/stats — corpus stats for the admin panel
// Returns total chunks, source breakdown, and full source list

import { createClient } from '@supabase/supabase-js';

function auth(req) {
  return req.headers.get('x-admin-secret') === process.env.ADMIN_SECRET;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200 });
  if (!auth(req)) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Total chunk count
  const { count: totalChunks } = await supabase
    .from('sean_chunks')
    .select('*', { count: 'exact', head: true });

  // Per-source breakdown — group by source_type + source_title + source_id
  const { data: rows, error } = await supabase
    .from('sean_chunks')
    .select('source_type, source_title, source_id');

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  // Aggregate in JS (Supabase free tier lacks group-by RPC)
  const sourceMap = new Map();
  for (const row of rows || []) {
    const key = `${row.source_type}::${row.source_title}`;
    if (!sourceMap.has(key)) {
      sourceMap.set(key, {
        source_type: row.source_type,
        source_title: row.source_title,
        source_id: row.source_id || null,
        chunk_count: 0
      });
    }
    sourceMap.get(key).chunk_count++;
  }

  const sources = Array.from(sourceMap.values())
    .sort((a, b) => a.source_type.localeCompare(b.source_type) || a.source_title.localeCompare(b.source_title));

  const transcriptCount = sources.filter(s => s.source_type === 'transcript').reduce((n, s) => n + s.chunk_count, 0);
  const bookCount = sources.filter(s => s.source_type === 'book').reduce((n, s) => n + s.chunk_count, 0);

  return new Response(JSON.stringify({
    totalChunks: totalChunks || 0,
    transcriptChunks: transcriptCount,
    bookChunks: bookCount,
    sourceCount: sources.length,
    sources
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

export const config = { runtime: 'edge' };
