// DELETE /api/admin/delete — remove all chunks for a source
//
// Body (JSON): { title: string, sourceType: string }

import { createClient } from '@supabase/supabase-js';

function auth(req) {
  return req.headers.get('x-admin-secret') === process.env.ADMIN_SECRET;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200 });
  if (req.method !== 'DELETE') return new Response('Method not allowed', { status: 405 });
  if (!auth(req)) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  let body;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const { title, sourceType } = body;
  if (!title || !sourceType) {
    return new Response(JSON.stringify({ error: 'title and sourceType required' }), { status: 400 });
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const { error, count } = await supabase
    .from('sean_chunks')
    .delete({ count: 'exact' })
    .eq('source_title', title)
    .eq('source_type', sourceType);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true, deleted: count }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

export const config = { runtime: 'edge' };
