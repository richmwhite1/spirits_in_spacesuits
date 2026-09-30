// /api/featured-videos.js — YouTube videos that aren't on Seán's own channel
// but should still appear in "Latest from Seán" on the homepage.
//
// /api/videos reads his channel's uploads playlist, so it can never see a talk
// or interview posted on someone else's channel. These rows are merged into the
// Latest feed by the homepage: pinned first, then newest-first by date.
//
// GET             → public list, pinned first then newest first
// POST            → admin: create
// PUT  ?id=UUID   → admin: update
// DELETE ?id=UUID → admin: delete

import { createClient } from '@supabase/supabase-js';

function auth(req) {
  return req.headers.get('x-admin-secret') === process.env.ADMIN_SECRET;
}

function db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

// Short s-maxage so a newly posted video shows up within minutes; the long
// stale-while-revalidate means visitors always get an instant cached response
// and the origin is only re-hit once per window.
const CACHE = 'public, s-maxage=600, stale-while-revalidate=604800';

// Pull the 11-char YouTube id out of any common URL shape (youtu.be, /watch?v=,
// /live/, /embed/, /shorts/), or accept a bare id. Returns null if none found.
export function extractVideoId(input) {
  if (!input) return null;
  const s = String(input).trim();
  const m = s.match(/(?:youtu\.be\/|youtube\.com\/live\/|youtube\.com\/shorts\/|[?&]v=|\/embed\/)([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{11}$/.test(s) ? s : null;
}

function fields(body) {
  const { title, youtube_url, source, published_at, pinned } = body;
  return {
    title: title?.trim(),
    youtube_url: youtube_url?.trim(),
    video_id: extractVideoId(youtube_url),
    source: source?.trim() || null,
    published_at: published_at?.trim() || null,
    pinned: pinned === true || pinned === 'true' || pinned === 1 || pinned === '1'
  };
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200 });

  const url = new URL(req.url);
  const supabase = db();

  // ── GET ──────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('featured_videos')
      .select('*')
      .order('pinned', { ascending: false })
      .order('published_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });
    // A missing table (migration not applied yet) must not blank the homepage.
    if (error) {
      console.error('/api/featured-videos GET:', error.message);
      return new Response(JSON.stringify({ featuredVideos: [], error: error.message }), {
        status: 200, headers: JSON_HEADERS
      });
    }
    return new Response(JSON.stringify({ featuredVideos: data ?? [] }), {
      headers: { ...JSON_HEADERS, 'Cache-Control': CACHE }
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
    const row = fields(body);
    if (!row.title)       return new Response(JSON.stringify({ error: 'title is required' }), { status: 400, headers: JSON_HEADERS });
    if (!row.youtube_url) return new Response(JSON.stringify({ error: 'youtube_url is required' }), { status: 400, headers: JSON_HEADERS });
    if (!row.video_id)    return new Response(JSON.stringify({ error: 'Could not read a YouTube video ID from that link' }), { status: 400, headers: JSON_HEADERS });

    const { data, error } = await supabase.from('featured_videos').insert(row).select().single();
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: JSON_HEADERS });
    return new Response(JSON.stringify({ video: data }), { status: 201, headers: JSON_HEADERS });
  }

  if (req.method === 'PUT') {
    const id = url.searchParams.get('id');
    if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: JSON_HEADERS });
    let body;
    try { body = await req.json(); } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: JSON_HEADERS });
    }
    const row = fields(body);
    if (!row.video_id) return new Response(JSON.stringify({ error: 'Could not read a YouTube video ID from that link' }), { status: 400, headers: JSON_HEADERS });

    const { data, error } = await supabase.from('featured_videos').update(row).eq('id', id).select().single();
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: JSON_HEADERS });
    return new Response(JSON.stringify({ video: data }), { headers: JSON_HEADERS });
  }

  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: JSON_HEADERS });
    const { error } = await supabase.from('featured_videos').delete().eq('id', id);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: JSON_HEADERS });
    return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS });
  }

  return new Response('Method not allowed', { status: 405 });
}

export const config = { runtime: 'edge' };
