// /api/dream-quotes — CRUD for Seán's dream quotes
// GET              → public list (all quotes)
// GET  ?today=1    → single quote for today (deterministic daily rotation)
// GET  ?id=UUID    → single quote by ID
// POST             → admin: create quote
// PUT  ?id=UUID    → admin: update quote
// DELETE ?id=UUID  → admin: delete quote

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
    const id    = url.searchParams.get('id');
    const today = url.searchParams.get('today');

    // Single quote by ID
    if (id) {
      const { data, error } = await supabase.from('dream_quotes').select('*').eq('id', id).single();
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 404, headers: JSON_HEADERS });
      return new Response(JSON.stringify({ quote: data }), { headers: JSON_HEADERS });
    }

    // Today's quote — deterministic by day of year
    if (today) {
      const { count } = await supabase
        .from('dream_quotes').select('*', { count: 'exact', head: true });
      if (!count) return new Response(JSON.stringify({ quote: null }), { headers: JSON_HEADERS });

      const now = new Date();
      const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
      const idx = dayOfYear % count;

      const { data } = await supabase
        .from('dream_quotes').select('*')
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true })
        .range(idx, idx);

      return new Response(JSON.stringify({ quote: data?.[0] ?? null }), {
        headers: { ...JSON_HEADERS, 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' }
      });
    }

    // Full list
    const search = url.searchParams.get('q')?.trim();
    let query = supabase
      .from('dream_quotes').select('*', { count: 'exact' })
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (search && search.length <= 200) {
      query = query.ilike('quote', `%${search}%`);
    }

    const { data, count, error } = await query;
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: JSON_HEADERS });

    return new Response(JSON.stringify({ quotes: data ?? [], total: count ?? 0 }), {
      headers: { ...JSON_HEADERS, 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=7200' }
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
    const { quote, sort_order } = body;
    if (!quote?.trim()) {
      return new Response(JSON.stringify({ error: 'quote is required' }), { status: 400, headers: JSON_HEADERS });
    }
    const { data, error } = await supabase
      .from('dream_quotes')
      .insert({ quote: quote.trim(), sort_order: Math.max(0, Math.min(9999, parseInt(sort_order) || 0)) })
      .select().single();
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: JSON_HEADERS });
    return new Response(JSON.stringify({ quote: data }), { status: 201, headers: JSON_HEADERS });
  }

  if (req.method === 'PUT') {
    const id = url.searchParams.get('id');
    if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: JSON_HEADERS });
    let body;
    try { body = await req.json(); } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: JSON_HEADERS });
    }
    const { quote, sort_order } = body;
    const { data, error } = await supabase
      .from('dream_quotes')
      .update({ quote: quote?.trim(), sort_order: Math.max(0, Math.min(9999, parseInt(sort_order) || 0)) })
      .eq('id', id).select().single();
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: JSON_HEADERS });
    return new Response(JSON.stringify({ quote: data }), { headers: JSON_HEADERS });
  }

  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: JSON_HEADERS });
    const { error } = await supabase.from('dream_quotes').delete().eq('id', id);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: JSON_HEADERS });
    return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS });
  }

  return new Response('Method not allowed', { status: 405 });
}

export const config = { runtime: 'edge' };
