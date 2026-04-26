// GET /api/admin/subscribers — list newsletter subscribers for the admin panel
// Supports ?search=term and ?page=N&limit=N for pagination
// DELETE with ?id=uuid removes a subscriber

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
  if (!auth(req)) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: JSON_HEADERS });

  const url = new URL(req.url);
  const supabase = db();

  // DELETE a subscriber
  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return new Response(JSON.stringify({ error: 'Missing id' }), { status: 400, headers: JSON_HEADERS });
    const { error } = await supabase.from('newsletter_subscribers').delete().eq('id', id);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: JSON_HEADERS });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: JSON_HEADERS });
  }

  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });

  const search = (url.searchParams.get('search') || '').trim();
  const page   = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const limit  = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '100')));
  const from   = (page - 1) * limit;

  let query = supabase
    .from('newsletter_subscribers')
    .select('id, email, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, from + limit - 1);

  if (search && search.length <= 200) query = query.ilike('email', `%${search}%`);

  const { data, count, error } = await query;
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: JSON_HEADERS });

  return new Response(JSON.stringify({ subscribers: data || [], total: count ?? 0 }), { status: 200, headers: JSON_HEADERS });
}

export const config = { runtime: 'edge' };
