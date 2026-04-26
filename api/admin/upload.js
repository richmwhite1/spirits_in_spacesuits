// POST /api/admin/upload — ingest a text/SRT document into the RAG corpus
//
// Body (JSON): {
//   text:       string   — raw file content
//   title:      string   — display title
//   sourceType: 'transcript' | 'book'
//   sourceId:   string?  — YouTube video ID (transcripts only)
//   sourceDate: string?  — e.g. "2024-03-15"
// }
//
// Returns: { ok: true, title, chunks: N } or { error: '...' }

import { createClient } from '@supabase/supabase-js';
import { embedBatch } from '../../lib/embed.js';
import { cleanTranscript, chunkText } from '../../lib/parse.js';

function auth(req) {
  return req.headers.get('x-admin-secret') === process.env.ADMIN_SECRET;
}

const CHUNK_SIZE  = 400;
const OVERLAP     = 80;

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200 });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!auth(req)) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }

  const { text, title, sourceType, sourceId, sourceDate } = body;

  if (!text || typeof text !== 'string' || text.trim().length < 50) {
    return new Response(JSON.stringify({ error: 'text is required (min 50 chars)' }), { status: 400 });
  }
  if (text.length > 5_000_000) {
    return new Response(JSON.stringify({ error: 'text is too large (max 5 MB)' }), { status: 400 });
  }
  if (!title || typeof title !== 'string') {
    return new Response(JSON.stringify({ error: 'title is required' }), { status: 400 });
  }
  if (!['transcript', 'book', 'essay', 'poem'].includes(sourceType)) {
    return new Response(JSON.stringify({ error: 'sourceType must be transcript, book, essay, or poem' }), { status: 400 });
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Dedup check
  const { data: existing } = await supabase
    .from('sean_chunks')
    .select('id')
    .eq('source_title', title)
    .eq('source_type', sourceType)
    .limit(1);

  if (existing && existing.length > 0) {
    return new Response(JSON.stringify({
      error: `"${title}" is already in the corpus. Delete it first if you want to re-ingest.`
    }), { status: 409 });
  }

  // Clean and chunk
  const cleaned = cleanTranscript(text);
  const chunks  = chunkText(cleaned, CHUNK_SIZE, OVERLAP);

  if (chunks.length === 0) {
    return new Response(JSON.stringify({ error: 'No usable text found after cleaning.' }), { status: 400 });
  }

  // Embed in batches using Gemini text-embedding-004
  const allEmbeddings = await embedBatch(chunks);

  // Store in Supabase (batches of 100)
  const rows = chunks.map((content, idx) => ({
    content,
    embedding:    allEmbeddings[idx],
    source_type:  sourceType,
    source_title: title,
    source_id:    sourceId || null,
    source_date:  sourceDate || null,
    chunk_index:  idx
  }));

  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await supabase.from('sean_chunks').insert(rows.slice(i, i + 100));
    if (error) {
      return new Response(JSON.stringify({ error: `Storage failed: ${error.message}` }), { status: 500 });
    }
  }

  return new Response(JSON.stringify({ ok: true, title, chunks: chunks.length, sourceType }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

export const config = { runtime: 'edge' };
