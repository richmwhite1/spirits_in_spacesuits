// /api/track — first-party, cookie-free analytics collection.
//
// The page batches events client-side and posts them here (usually via sendBeacon
// on pagehide), so a whole visit is typically two writes: the pageview on arrival
// and everything else on the way out. Always returns 204 — a tracking failure must
// never surface to a reader, and the client ignores the body regardless.

import { createClient } from '@supabase/supabase-js';
import { getCountry, getDevice, isBot, referrerHost, visitorHash } from '../lib/analytics.js';

const NO_CONTENT = { status: 204 };

// What the client is allowed to record. Anything else is dropped rather than stored,
// so a stray script can't invent event types the dashboard doesn't understand.
const ALLOWED = new Set(['pageview', 'section', 'video', 'outbound', 'download', 'subscribe', 'testimonial']);

const MAX_EVENTS = 30;
const REQUESTS_PER_IP_PER_DAY = 300;

const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) || null : null);

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200 });
  if (req.method !== 'POST') return new Response(null, { status: 405 });

  const ua = req.headers.get('user-agent') || '';
  if (isBot(ua)) return new Response(null, NO_CONTENT);

  let body;
  try { body = await req.json(); } catch { return new Response(null, NO_CONTENT); }

  const incoming = Array.isArray(body?.e) ? body.e.slice(0, MAX_EVENTS) : [];
  if (!incoming.length) return new Response(null, NO_CONTENT);

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Cheap flood guard. Fails open: dropping real analytics because the limiter is
  // unavailable is worse than the abuse it prevents.
  try {
    const { data: count } = await supabase.rpc('increment_rate_limit', {
      p_ip: `trk::${req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'}`,
      p_date: new Date().toISOString().split('T')[0]
    });
    if ((count || 1) > REQUESTS_PER_IP_PER_DAY) return new Response(null, NO_CONTENT);
  } catch { /* fail open */ }

  const visitor = await visitorHash(req);
  const device = getDevice(ua);
  const country = getCountry(req);
  const path = clean(body.p, 200) || '/';
  const session = clean(body.s, 40);
  const referrer = referrerHost(clean(body.r, 500), new URL(req.url).hostname);

  const rows = incoming
    .filter(ev => ev && ALLOWED.has(ev.t))
    .map(ev => ({
      event: ev.t,
      label: clean(ev.l, 200),
      path,
      referrer,
      device,
      country,
      visitor,
      session
    }));

  if (!rows.length) return new Response(null, NO_CONTENT);

  try {
    await supabase.from('analytics_events').insert(rows);
  } catch (err) {
    console.error('/api/track insert failed:', err.message);
  }

  return new Response(null, NO_CONTENT);
}

export const config = { runtime: 'edge' };
