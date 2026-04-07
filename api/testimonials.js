// /api/testimonials — public submission + admin moderation
// GET                → public: approved testimonials only
// POST               → public: submit a testimonial (lands as pending)
// PATCH ?id=UUID     → admin: { approved: true/false }
// DELETE ?id=UUID    → admin: permanently delete

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
    if (auth(req)) {
      // Admin: return all, with optional status filter
      const status = url.searchParams.get('status'); // 'pending' | 'approved'
      let query = supabase.from('testimonials').select('*').order('created_at', { ascending: false });
      if (status === 'pending')  query = query.eq('approved', false);
      if (status === 'approved') query = query.eq('approved', true);
      const { data, error } = await query;
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: JSON_HEADERS });
      return new Response(JSON.stringify({ testimonials: data ?? [] }), { headers: JSON_HEADERS });
    }
    // Public: approved only, no admin fields exposed
    const { data, error } = await supabase
      .from('testimonials')
      .select('id, name, location, message, created_at')
      .eq('approved', true)
      .order('created_at', { ascending: false });
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: JSON_HEADERS });
    return new Response(JSON.stringify({ testimonials: data ?? [] }), {
      headers: { ...JSON_HEADERS, 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' }
    });
  }

  if (req.method === 'POST') {
    const body = await req.json();
    const { name, location, message } = body;
    if (!name?.trim() || !message?.trim()) {
      return new Response(JSON.stringify({ error: 'name and message are required' }), { status: 400, headers: JSON_HEADERS });
    }
    if (message.trim().length < 10) {
      return new Response(JSON.stringify({ error: 'Message is too short (minimum 10 characters)' }), { status: 400, headers: JSON_HEADERS });
    }
    const { error } = await supabase.from('testimonials').insert({
      name:     name.trim(),
      location: location?.trim() || null,
      message:  message.trim(),
      approved: false,
    });
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: JSON_HEADERS });
    return new Response(JSON.stringify({ ok: true }), { status: 201, headers: JSON_HEADERS });
  }

  if (!auth(req)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: JSON_HEADERS });
  }

  if (req.method === 'PATCH') {
    const id = url.searchParams.get('id');
    if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: JSON_HEADERS });
    const body = await req.json();
    const { data, error } = await supabase
      .from('testimonials')
      .update({ approved: !!body.approved })
      .eq('id', id)
      .select().single();
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: JSON_HEADERS });
    return new Response(JSON.stringify({ testimonial: data }), { headers: JSON_HEADERS });
  }

  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: JSON_HEADERS });
    const { error } = await supabase.from('testimonials').delete().eq('id', id);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: JSON_HEADERS });
    return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS });
  }

  return new Response('Method not allowed', { status: 405 });
}

export const config = { runtime: 'edge' };
