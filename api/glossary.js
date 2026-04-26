// /api/glossary.js — CRUD for Seán's glossary terms
// GET             → public list, ordered alphabetically
// POST            → admin: create term
// PUT  ?id=UUID   → admin: update term
// DELETE ?id=UUID → admin: delete term

import { createClient } from '@supabase/supabase-js';

function auth(req) {
  return req.headers.get('x-admin-secret') === process.env.ADMIN_SECRET;
}

function db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200 });

  const url = new URL(req.url);
  const supabase = db();

  // ── GET ──────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('glossary')
      .select('*')
      .order('term', { ascending: true });
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: JSON_HEADERS });
    return new Response(JSON.stringify({ terms: data ?? [] }), {
      headers: { ...JSON_HEADERS, 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' }
    });
  }

  // ── WRITE — admin only ───────────────────────────────────────────────
  if (!auth(req)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: JSON_HEADERS });
  }

  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: JSON_HEADERS });
    }
    const { term, definition } = body;
    if (!term?.trim()) return new Response(JSON.stringify({ error: 'term is required' }), { status: 400, headers: JSON_HEADERS });
    if (!definition?.trim()) return new Response(JSON.stringify({ error: 'definition is required' }), { status: 400, headers: JSON_HEADERS });
    const { data, error } = await supabase
      .from('glossary')
      .insert({ term: term.trim(), definition: definition.trim() })
      .select().single();
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: JSON_HEADERS });
    return new Response(JSON.stringify({ term: data }), { status: 201, headers: JSON_HEADERS });
  }

  if (req.method === 'PUT') {
    const id = url.searchParams.get('id');
    if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: JSON_HEADERS });
    let body;
    try { body = await req.json(); } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: JSON_HEADERS });
    }
    const { term, definition } = body;
    const { data, error } = await supabase
      .from('glossary')
      .update({ term: term?.trim(), definition: definition?.trim() })
      .eq('id', id).select().single();
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: JSON_HEADERS });
    return new Response(JSON.stringify({ term: data }), { headers: JSON_HEADERS });
  }

  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: JSON_HEADERS });
    const { error } = await supabase.from('glossary').delete().eq('id', id);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: JSON_HEADERS });
    return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS });
  }

  return new Response('Method not allowed', { status: 405 });
}

export const config = { runtime: 'edge' };
