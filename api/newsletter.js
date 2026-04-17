// /api/newsletter — email newsletter signup
// POST { email } → stores in Supabase `newsletter_subscribers` table
// Requires table: id (uuid), email (text unique), created_at (timestamptz default now())

import { createClient } from '@supabase/supabase-js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200 });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let body;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: JSON_HEADERS });
  }

  const email = (body.email || '').trim().toLowerCase().slice(0, 254);
  if (!EMAIL_RE.test(email)) {
    return new Response(JSON.stringify({ error: 'Please enter a valid email address.' }), { status: 400, headers: JSON_HEADERS });
  }

  const supabase = db();
  const { error } = await supabase
    .from('newsletter_subscribers')
    .insert({ email })
    .select()
    .single();

  if (error) {
    // Unique violation — already subscribed
    if (error.code === '23505') {
      return new Response(JSON.stringify({ ok: true, message: 'You are already subscribed.' }), { status: 200, headers: JSON_HEADERS });
    }
    console.error('/api/newsletter error:', error.message);
    return new Response(JSON.stringify({ error: 'Something went wrong. Please try again.' }), { status: 500, headers: JSON_HEADERS });
  }

  return new Response(JSON.stringify({ ok: true, message: 'Thank you — you\'re on the list.' }), { status: 201, headers: JSON_HEADERS });
}

export const config = { runtime: 'edge' };
