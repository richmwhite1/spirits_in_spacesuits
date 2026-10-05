// GET /api/admin/analytics?period=month — the whole engagement dashboard in one payload.
//
// period is a calendar window: today | week | month | year | all. All the
// aggregation happens in Postgres (analytics_summary), so this is a single round
// trip regardless of how many panels the dashboard grows.

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

  const PERIODS = ['today', 'week', 'month', 'year', 'all'];
  const requested = (new URL(req.url).searchParams.get('period') || 'month').toLowerCase();
  const period = PERIODS.includes(requested) ? requested : 'month';

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data, error } = await supabase.rpc('analytics_summary', { p_period: period });

  if (error) {
    // The panel is useless — and confusing — if the migration hasn't been applied
    // yet, so say so explicitly rather than showing a generic failure.
    const notReady = /does not exist|schema cache|could not find/i.test(error.message || '');
    return new Response(JSON.stringify({
      error: error.message,
      notReady,
      hint: notReady ? 'Apply the migrations in supabase/migrations/ (20260930_analytics.sql, 20261005_analytics_periods.sql), then reload.' : undefined
    }), { status: notReady ? 200 : 500, headers: JSON_HEADERS });
  }

  return new Response(JSON.stringify(data), { status: 200, headers: JSON_HEADERS });
}

export const config = { runtime: 'edge' };
