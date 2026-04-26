// /api/stories — CRUD for Seán's stories & meditations
// GET  ?limit=20&offset=0  → public, paginated list
// GET  ?today=1            → single story for today (deterministic daily rotation)
// GET  ?id=UUID            → single story by ID
// POST                     → admin: create story
// PUT  ?id=UUID            → admin: update story
// DELETE ?id=UUID          → admin: delete story

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
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);
    const offset = parseInt(url.searchParams.get('offset') || '0');

    // Single story by ID
    if (id) {
      const { data, error } = await supabase.from('stories').select('*').eq('id', id).single();
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 404, headers: JSON_HEADERS });
      return new Response(JSON.stringify({ story: data }), { headers: JSON_HEADERS });
    }

    // Today's feature — deterministic by day of year, across all content types
    if (today) {
      const { count } = await supabase
        .from('stories').select('*', { count: 'exact', head: true });
      if (!count) return new Response(JSON.stringify({ story: null }), { headers: JSON_HEADERS });

      const now = new Date();
      const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
      const idx = dayOfYear % count;

      const { data } = await supabase
        .from('stories').select('*')
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true })
        .range(idx, idx);

      return new Response(JSON.stringify({ story: data?.[0] ?? null }), {
        headers: { ...JSON_HEADERS, 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' }
      });
    }

    // Paginated list — optionally filter by content_type and/or search query
    const contentType = url.searchParams.get('type'); // 'story'|'essay'|'poem'
    const search = url.searchParams.get('q')?.trim();

    let query = supabase
      .from('stories').select('*', { count: 'exact' })
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
      .range(offset, offset + limit - 1);

    if (contentType && ['story','essay','poem'].includes(contentType)) {
      query = query.eq('content_type', contentType);
    }
    if (search && search.length <= 200) {
      query = query.ilike('title', `%${search}%`);
    }

    const { data, count, error } = await query;

    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: JSON_HEADERS });

    return new Response(JSON.stringify({ stories: data ?? [], total: count ?? 0 }), {
      headers: { ...JSON_HEADERS, 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' }
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
    const { title, excerpt, body: storyBody, story_date, content_type, sort_order } = body;
    if (!title?.trim()) {
      return new Response(JSON.stringify({ error: 'title is required' }), { status: 400, headers: JSON_HEADERS });
    }
    const type = ['story','essay','poem'].includes(content_type) ? content_type : 'story';
    const { data, error } = await supabase
      .from('stories')
      .insert({ title: title.trim(), excerpt: excerpt?.trim() || null, body: storyBody || null, story_date: story_date?.trim() || null, content_type: type, sort_order: Math.max(0, Math.min(9999, parseInt(sort_order) || 0)) })
      .select().single();
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: JSON_HEADERS });
    return new Response(JSON.stringify({ story: data }), { status: 201, headers: JSON_HEADERS });
  }

  if (req.method === 'PUT') {
    const id = url.searchParams.get('id');
    if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: JSON_HEADERS });
    let body;
    try { body = await req.json(); } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: JSON_HEADERS });
    }
    const { title, excerpt, body: storyBody, story_date, content_type, sort_order } = body;
    const type = ['story','essay','poem'].includes(content_type) ? content_type : 'story';
    const { data, error } = await supabase
      .from('stories')
      .update({ title: title?.trim(), excerpt: excerpt?.trim() || null, body: storyBody || null, story_date: story_date?.trim() || null, content_type: type, sort_order: Math.max(0, Math.min(9999, parseInt(sort_order) || 0)) })
      .eq('id', id).select().single();
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: JSON_HEADERS });
    return new Response(JSON.stringify({ story: data }), { headers: JSON_HEADERS });
  }

  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: JSON_HEADERS });
    const { error } = await supabase.from('stories').delete().eq('id', id);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: JSON_HEADERS });
    return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS });
  }

  return new Response('Method not allowed', { status: 405 });
}

export const config = { runtime: 'edge' };
