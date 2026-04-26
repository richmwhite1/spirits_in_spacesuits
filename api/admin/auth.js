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
    return false; // fail closed — block on DB error to prevent brute force
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

  const secret = req.headers.get('x-admin-secret') || '';
  const expected = process.env.ADMIN_SECRET || '';
  // Constant-time comparison via HMAC — prevents timing attacks regardless of input length
  const enc = new TextEncoder();
  const keyData = enc.encode('spirits-auth-compare');
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const [macA, macB] = await Promise.all([
    crypto.subtle.sign('HMAC', key, enc.encode(secret)),
    crypto.subtle.sign('HMAC', key, enc.encode(expected)),
  ]);
  const a = new Uint8Array(macA);
  const b = new Uint8Array(macB);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  if (!secret || diff !== 0) {
    return new Response(JSON.stringify({ error: 'Invalid password' }), {
      status: 401,
      headers: JSON_HEADERS
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store' }
  });
}

export const config = { runtime: 'edge' };
