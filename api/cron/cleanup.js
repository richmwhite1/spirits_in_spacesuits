// /api/cron/cleanup — daily housekeeping
// Trims rate_limits (>7 days old) and ask_cache (>7 days old) so neither table grows forever.
// Invoked by Vercel Cron; protected by CRON_SECRET.

import { getSupabase } from '../../lib/supabase.js';

export default async function handler(req) {
  // Vercel Cron sends Authorization: Bearer <CRON_SECRET>
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supabase = getSupabase();
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const cutoffDate = cutoff.split('T')[0];

  const [rl, ac] = await Promise.all([
    supabase.from('rate_limits').delete().lt('date', cutoffDate).select('ip'),
    supabase.from('ask_cache').delete().lt('created_at', cutoff).select('question_hash')
  ]);

  return new Response(JSON.stringify({
    rate_limits_deleted: rl.data?.length ?? 0,
    ask_cache_deleted: ac.data?.length ?? 0,
    rate_limits_error: rl.error?.message ?? null,
    ask_cache_error: ac.error?.message ?? null
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

export const config = { runtime: 'edge' };
