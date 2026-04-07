// /api/books.js — CRUD for Seán's books
// GET             → public list, ordered by sort_order
// POST            → admin: create book
// PUT  ?id=UUID   → admin: update book
// DELETE ?id=UUID → admin: delete book

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
      .from('books')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: JSON_HEADERS });
    return new Response(JSON.stringify({ books: data ?? [] }), {
      headers: { ...JSON_HEADERS, 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' }
    });
  }

  // ── WRITE — admin only ───────────────────────────────────────────────
  if (!auth(req)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: JSON_HEADERS });
  }

  if (req.method === 'POST') {
    const body = await req.json();
    const { title, subtitle, badge_text, description, cover_url, links, sort_order } = body;
    if (!title?.trim()) {
      return new Response(JSON.stringify({ error: 'title is required' }), { status: 400, headers: JSON_HEADERS });
    }
    const { data, error } = await supabase
      .from('books')
      .insert({
        title: title.trim(),
        subtitle: subtitle?.trim() || null,
        badge_text: badge_text?.trim() || null,
        description: description?.trim() || null,
        cover_url: cover_url?.trim() || null,
        links: links || [],
        sort_order: sort_order ?? 0
      })
      .select().single();
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: JSON_HEADERS });
    return new Response(JSON.stringify({ book: data }), { status: 201, headers: JSON_HEADERS });
  }

  if (req.method === 'PUT') {
    const id = url.searchParams.get('id');
    if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: JSON_HEADERS });
    const body = await req.json();
    const { title, subtitle, badge_text, description, cover_url, links, sort_order } = body;
    const { data, error } = await supabase
      .from('books')
      .update({
        title: title?.trim(),
        subtitle: subtitle?.trim() || null,
        badge_text: badge_text?.trim() || null,
        description: description?.trim() || null,
        cover_url: cover_url?.trim() || null,
        links: links || [],
        sort_order: sort_order ?? 0
      })
      .eq('id', id).select().single();
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: JSON_HEADERS });
    return new Response(JSON.stringify({ book: data }), { headers: JSON_HEADERS });
  }

  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: JSON_HEADERS });
    const { error } = await supabase.from('books').delete().eq('id', id);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: JSON_HEADERS });
    return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS });
  }

  return new Response('Method not allowed', { status: 405 });
}

export const config = { runtime: 'edge' };
