// POST /api/admin/auth — verify admin password
// Returns { ok: true } or 401
// Brute-force protection: 20 attempts per IP per day

import { createClient } from '@supabase/supabase-js';

const LOGIN_DAILY_LIMIT = 20;
const JSON_HEADERS = { 'Content-Type': 'application/json' };

function getIP(req) {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

async function checkLoginLimit(ip) {
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const today = new Date().toISOString().split('T')[0];
    const { data } = await supabase.rpc('increment_rate_limit', {
      p_ip: `auth::${ip}`,
      p_date: today
    });
    return (data || 1) <= LOGIN_DAILY_LIMIT;
  } catch {
    return true; // fail open — don't lock out on DB error
  }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200 });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const ip = getIP(req);
  const allowed = await checkLoginLimit(ip);
  if (!allowed) {
    return new Response(JSON.stringify({ error: 'Too many attempts. Try again tomorrow.' }), {
      status: 429,
      headers: JSON_HEADERS
    });
  }

  const secret = req.headers.get('x-admin-secret');
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return new Response(JSON.stringify({ error: 'Invalid password' }), {
      status: 401,
      headers: JSON_HEADERS
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: JSON_HEADERS
  });
}

export const config = { runtime: 'edge' };
