// /api/podcasts.js — CRUD for Seán's guest appearances on other people's shows
// These are external podcasts/interviews (not his own YouTube channel feed, which
// is served by /api/videos). Admin-managed via the admin panel; publicly listed.
// GET             → public list, newest first
// POST            → admin: create podcast
// PUT  ?id=UUID   → admin: update podcast
// DELETE ?id=UUID → admin: delete podcast

import { createClient } from '@supabase/supabase-js';

function auth(req) {
  return req.headers.get('x-admin-secret') === process.env.ADMIN_SECRET;
}

function db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

// Pull the 11-char YouTube id out of any common URL shape (youtu.be, /watch?v=,
// /live/, /embed/). Returns null if none found.
function extractVideoId(url) {
  if (!url) return null;
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/live\/|[?&]v=|\/embed\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200 });

  const url = new URL(req.url);
  const supabase = db();

  // ── GET ──────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('podcasts')
      .select('*')
      .order('aired_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: JSON_HEADERS });
    return new Response(JSON.stringify({ podcasts: data ?? [] }), {
      headers: { ...JSON_HEADERS, 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800' }
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
    const { host, title, youtube_url, aired_date, duration_seconds } = body;
    if (!host?.trim())        return new Response(JSON.stringify({ error: 'host is required' }), { status: 400, headers: JSON_HEADERS });
    if (!title?.trim())       return new Response(JSON.stringify({ error: 'title is required' }), { status: 400, headers: JSON_HEADERS });
    if (!youtube_url?.trim()) return new Response(JSON.stringify({ error: 'youtube_url is required' }), { status: 400, headers: JSON_HEADERS });
    const { data, error } = await supabase
      .from('podcasts')
      .insert({
        host: host.trim(),
        title: title.trim(),
        youtube_url: youtube_url.trim(),
        video_id: extractVideoId(youtube_url),
        aired_date: aired_date?.trim() || null,
        duration_seconds: duration_seconds != null && duration_seconds !== '' ? Math.max(0, parseInt(duration_seconds) || 0) : null
      })
      .select().single();
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: JSON_HEADERS });
    return new Response(JSON.stringify({ podcast: data }), { status: 201, headers: JSON_HEADERS });
  }

  if (req.method === 'PUT') {
    const id = url.searchParams.get('id');
    if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: JSON_HEADERS });
    let body;
    try { body = await req.json(); } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: JSON_HEADERS });
    }
    const { host, title, youtube_url, aired_date, duration_seconds } = body;
    const { data, error } = await supabase
      .from('podcasts')
      .update({
        host: host?.trim(),
        title: title?.trim(),
        youtube_url: youtube_url?.trim(),
        video_id: extractVideoId(youtube_url),
        aired_date: aired_date?.trim() || null,
        duration_seconds: duration_seconds != null && duration_seconds !== '' ? Math.max(0, parseInt(duration_seconds) || 0) : null
      })
      .eq('id', id).select().single();
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: JSON_HEADERS });
    return new Response(JSON.stringify({ podcast: data }), { headers: JSON_HEADERS });
  }

  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: JSON_HEADERS });
    const { error } = await supabase.from('podcasts').delete().eq('id', id);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: JSON_HEADERS });
    return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS });
  }

  return new Response('Method not allowed', { status: 405 });
}

export const config = { runtime: 'edge' };
