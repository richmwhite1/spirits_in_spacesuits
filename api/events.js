// /api/events — public event listings + admin CRUD
// GET              → public: upcoming events (today onwards), sorted by date ASC
// GET ?all=1       → admin: all events including past
// POST             → admin: create event
// PUT  ?id=UUID    → admin: update event
// DELETE ?id=UUID  → admin: delete event

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

  if (req.method === 'GET') {
    const showAll = url.searchParams.get('all') && auth(req);
    let query = supabase.from('events').select('*').order('event_date', { ascending: true });
    if (!showAll) {
      const today = new Date().toISOString().split('T')[0];
      query = query.gte('event_date', today);
    }
    const { data, error } = await query;
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: JSON_HEADERS });
    return new Response(JSON.stringify({ events: data ?? [] }), {
      headers: { ...JSON_HEADERS, 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' }
    });
  }

  if (!auth(req)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: JSON_HEADERS });
  }

  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: JSON_HEADERS });
    }
    const { title, event_date, event_time, location, description, link } = body;
    if (!title?.trim() || !event_date) {
      return new Response(JSON.stringify({ error: 'title and event_date are required' }), { status: 400, headers: JSON_HEADERS });
    }
    if (link && !/^https?:\/\//.test(link.trim())) {
      return new Response(JSON.stringify({ error: 'link must be a valid URL' }), { status: 400, headers: JSON_HEADERS });
    }
    const { data, error } = await supabase
      .from('events')
      .insert({
        title: title.trim(),
        event_date,
        event_time: event_time?.trim() || null,
        location:   location?.trim()   || null,
        description: description?.trim() || null,
        link:       link?.trim()        || null,
      })
      .select().single();
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: JSON_HEADERS });
    return new Response(JSON.stringify({ event: data }), { status: 201, headers: JSON_HEADERS });
  }

  if (req.method === 'PUT') {
    const id = url.searchParams.get('id');
    if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: JSON_HEADERS });
    let body;
    try { body = await req.json(); } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: JSON_HEADERS });
    }
    const { title, event_date, event_time, location, description, link } = body;
    if (!title?.trim() || !event_date) {
      return new Response(JSON.stringify({ error: 'title and event_date are required' }), { status: 400, headers: JSON_HEADERS });
    }
    if (link && !/^https?:\/\//.test(link.trim())) {
      return new Response(JSON.stringify({ error: 'link must be a valid URL' }), { status: 400, headers: JSON_HEADERS });
    }
    const { data, error } = await supabase
      .from('events')
      .update({
        title: title.trim(),
        event_date,
        event_time: event_time?.trim() || null,
        location:   location?.trim()   || null,
        description: description?.trim() || null,
        link:       link?.trim()        || null,
      })
      .eq('id', id).select().single();
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: JSON_HEADERS });
    return new Response(JSON.stringify({ event: data }), { headers: JSON_HEADERS });
  }

  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: JSON_HEADERS });
    const { error } = await supabase.from('events').delete().eq('id', id);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: JSON_HEADERS });
    return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS });
  }

  return new Response('Method not allowed', { status: 405 });
}

export const config = { runtime: 'edge' };
