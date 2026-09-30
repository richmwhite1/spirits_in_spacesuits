// /api/cron/cleanup — daily housekeeping
// Trims rate_limits and ask_cache (>7 days) and the analytics tables (raw events
// >180 days, question log >365) so none of them grows forever. The dashboard's
// longest window is 365 days, and raw per-event rows stop being interesting long
// before that.
// Invoked by Vercel Cron; protected by CRON_SECRET.

import { getSupabase } from '../../lib/supabase.js';

export default async function handler(req) {
  // Vercel Cron sends Authorization: Bearer <CRON_SECRET>
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supabase = getSupabase();
  const days = n => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
  const cutoff = days(7);
  const cutoffDate = cutoff.split('T')[0];

  const [rl, ac, ae, al] = await Promise.all([
    supabase.from('rate_limits').delete().lt('date', cutoffDate).select('ip'),
    supabase.from('ask_cache').delete().lt('created_at', cutoff).select('question_hash'),
    supabase.from('analytics_events').delete().lt('created_at', days(180)).select('id'),
    supabase.from('ask_log').delete().lt('created_at', days(365)).select('id')
  ]);

  return new Response(JSON.stringify({
    rate_limits_deleted: rl.data?.length ?? 0,
    ask_cache_deleted: ac.data?.length ?? 0,
    analytics_events_deleted: ae.data?.length ?? 0,
    ask_log_deleted: al.data?.length ?? 0,
    rate_limits_error: rl.error?.message ?? null,
    ask_cache_error: ac.error?.message ?? null,
    analytics_events_error: ae.error?.message ?? null,
    ask_log_error: al.error?.message ?? null
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

export const config = { runtime: 'edge' };
