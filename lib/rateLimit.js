// Rate limiting via Supabase
// Stores request counts per IP per day — resets automatically at midnight UTC
// No external service needed, uses the same Supabase instance as the vector DB

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const DAILY_LIMIT = parseInt(process.env.RATE_LIMIT_DAILY || '20');

// SQL to create the rate_limits table (run once in Supabase SQL editor):
// CREATE TABLE rate_limits (
//   ip TEXT NOT NULL,
//   date DATE NOT NULL DEFAULT CURRENT_DATE,
//   count INTEGER NOT NULL DEFAULT 0,
//   PRIMARY KEY (ip, date)
// );

export async function checkRateLimit(ip) {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  // Upsert: increment count if row exists, insert with count=1 if not
  const { data, error } = await supabase.rpc('increment_rate_limit', {
    p_ip: ip,
    p_date: today
  });

  if (error) {
    // Fail closed — block request on DB error to prevent abuse during outages
    console.error('Rate limit check failed:', error.message);
    return { allowed: false, remaining: 0 };
  }

  const count = data || 1;
  const allowed = count <= DAILY_LIMIT;
  const remaining = Math.max(0, DAILY_LIMIT - count);

  return { allowed, remaining, count };
}

// Helper to get real IP from Vercel (handles proxies correctly)
export function getIP(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

// Standard rate limit response
export function rateLimitResponse() {
  return new Response(
    JSON.stringify({
      error: 'Daily limit reached',
      message: "You've reached today's limit of questions. Come back tomorrow — the archive will still be here.",
      retry_after: 'tomorrow'
    }),
    {
      status: 429,
      headers: { 'Content-Type': 'application/json' }
    }
  );
}
