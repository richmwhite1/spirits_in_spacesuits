// /api/models — CRUD for Models of Reality
// GET              → public, all models ordered by sort_order
// POST             → admin: create model
// PUT  ?id=UUID    → admin: update model
// DELETE ?id=UUID  → admin: delete model

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
    const { data, error } = await supabase
      .from('models')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: JSON_HEADERS });

    return new Response(JSON.stringify({ models: data ?? [] }), {
      headers: { ...JSON_HEADERS, 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' }
    });
  }

  if (!auth(req)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: JSON_HEADERS });
  }

  if (req.method === 'POST') {
    const body = await req.json();
    const { num, title, subtitle, description, image_url, video_id, video_title, keys, sort_order } = body;
    if (!title?.trim()) {
      return new Response(JSON.stringify({ error: 'title is required' }), { status: 400, headers: JSON_HEADERS });
    }
    const { data, error } = await supabase
      .from('models')
      .insert({
        num: num?.trim() || null,
        title: title.trim(),
        subtitle: subtitle?.trim() || null,
        description: description?.trim() || null,
        image_url: image_url?.trim() || null,
        video_id: video_id?.trim() || null,
        video_title: video_title?.trim() || null,
        keys: Array.isArray(keys) ? keys : [],
        sort_order: sort_order ?? 0
      })
      .select().single();
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: JSON_HEADERS });
    return new Response(JSON.stringify({ model: data }), { status: 201, headers: JSON_HEADERS });
  }

  if (req.method === 'PUT') {
    const id = url.searchParams.get('id');
    if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: JSON_HEADERS });
    const body = await req.json();
    const { num, title, subtitle, description, image_url, video_id, video_title, keys, sort_order } = body;
    const { data, error } = await supabase
      .from('models')
      .update({
        num: num?.trim() || null,
        title: title?.trim(),
        subtitle: subtitle?.trim() || null,
        description: description?.trim() || null,
        image_url: image_url?.trim() || null,
        video_id: video_id?.trim() || null,
        video_title: video_title?.trim() || null,
        keys: Array.isArray(keys) ? keys : [],
        sort_order: sort_order ?? 0
      })
      .eq('id', id).select().single();
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: JSON_HEADERS });
    return new Response(JSON.stringify({ model: data }), { headers: JSON_HEADERS });
  }

  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: JSON_HEADERS });
    const { error } = await supabase.from('models').delete().eq('id', id);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: JSON_HEADERS });
    return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS });
  }

  return new Response('Method not allowed', { status: 405 });
}

export const config = { runtime: 'edge' };
