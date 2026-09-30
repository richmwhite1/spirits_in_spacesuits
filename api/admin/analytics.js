// GET /api/admin/analytics?days=30 — the whole engagement dashboard in one payload.
//
// All the aggregation happens in Postgres (analytics_summary), so this is a single
// round trip regardless of how many panels the dashboard grows.

import { createClient } from '@supabase/supabase-js';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function auth(req) {
  return req.headers.get('x-admin-secret') === process.env.ADMIN_SECRET;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200 });
  if (!auth(req)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: JSON_HEADERS });
  }

  const days = Math.min(Math.max(parseInt(new URL(req.url).searchParams.get('days') || '30', 10) || 30, 1), 365);

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data, error } = await supabase.rpc('analytics_summary', { p_days: days });

  if (error) {
    // The panel is useless — and confusing — if the migration hasn't been applied
    // yet, so say so explicitly rather than showing a generic failure.
    const notReady = /does not exist|schema cache|could not find/i.test(error.message || '');
    return new Response(JSON.stringify({
      error: error.message,
      notReady,
      hint: notReady ? 'Apply supabase/migrations/20260930_analytics.sql, then reload.' : undefined
    }), { status: notReady ? 200 : 500, headers: JSON_HEADERS });
  }

  return new Response(JSON.stringify(data), { status: 200, headers: JSON_HEADERS });
}

export const config = { runtime: 'edge' };
