// /api/courses.js — CRUD for Seán's courses
// GET             → public list, ordered by sort_order
// POST            → admin: create course
// PUT  ?id=UUID   → admin: update course
// DELETE ?id=UUID → admin: delete course

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
      .from('courses')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: JSON_HEADERS });
    return new Response(JSON.stringify({ courses: data ?? [] }), {
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
    const { title, subtitle, description, image_url, link, status, sort_order } = body;
    if (!title?.trim()) {
      return new Response(JSON.stringify({ error: 'title is required' }), { status: 400, headers: JSON_HEADERS });
    }
    const validStatuses = ['coming_soon', 'available', 'in_progress'];
    const { data, error } = await supabase
      .from('courses')
      .insert({
        title: title.trim(),
        subtitle: subtitle?.trim() || null,
        description: description?.trim() || null,
        image_url: image_url?.trim() || null,
        link: link?.trim() || null,
        status: validStatuses.includes(status) ? status : 'coming_soon',
        sort_order: Math.max(0, Math.min(9999, parseInt(sort_order) || 0))
      })
      .select().single();
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: JSON_HEADERS });
    return new Response(JSON.stringify({ course: data }), { status: 201, headers: JSON_HEADERS });
  }

  if (req.method === 'PUT') {
    const id = url.searchParams.get('id');
    if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: JSON_HEADERS });
    let body;
    try { body = await req.json(); } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: JSON_HEADERS });
    }
    const { title, subtitle, description, image_url, link, status, sort_order } = body;
    const validStatuses = ['coming_soon', 'available', 'in_progress'];
    const { data, error } = await supabase
      .from('courses')
      .update({
        title: title?.trim(),
        subtitle: subtitle?.trim() || null,
        description: description?.trim() || null,
        image_url: image_url?.trim() || null,
        link: link?.trim() || null,
        status: validStatuses.includes(status) ? status : 'coming_soon',
        sort_order: Math.max(0, Math.min(9999, parseInt(sort_order) || 0))
      })
      .eq('id', id).select().single();
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: JSON_HEADERS });
    return new Response(JSON.stringify({ course: data }), { headers: JSON_HEADERS });
  }

  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: JSON_HEADERS });
    const { error } = await supabase.from('courses').delete().eq('id', id);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: JSON_HEADERS });
    return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS });
  }

  return new Response('Method not allowed', { status: 405 });
}

export const config = { runtime: 'edge' };
