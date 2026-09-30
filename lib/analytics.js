// Shared analytics helpers for the edge functions that write to `analytics_events`
// and `ask_log`.
//
// The visitor id is a salted SHA-256 of IP + user-agent that rotates every UTC day.
// It is deliberately not reversible and deliberately not stable across days: it
// supports "how many people came today" without building a profile of anyone.

const BOT_RE = /bot|crawl|spider|slurp|preview|fetch|curl|wget|headless|lighthouse|pingdom|monitor|python-requests|axios|node-fetch|semrush|ahrefs|facebookexternalhit|embedly|whatsapp|telegram|discord|gptbot|claudebot|perplexity/i;

export function isBot(ua) {
  return !ua || BOT_RE.test(ua);
}

export function getIP(req) {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

export function getCountry(req) {
  const c = req.headers.get('x-vercel-ip-country');
  return c && /^[A-Z]{2}$/.test(c) ? c : null;
}

export function getDevice(ua = '') {
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/i.test(ua)) return 'tablet';
  if (/mobi|iphone|ipod|android|blackberry|iemobile|opera mini/i.test(ua)) return 'mobile';
  return 'desktop';
}

// Daily-rotating pseudonymous id. ANALYTICS_SALT is optional — without it the hash
// is still one-way, it just isn't secret from someone who can guess the inputs.
export async function visitorHash(req) {
  const day = new Date().toISOString().slice(0, 10);
  const salt = process.env.ANALYTICS_SALT || process.env.CRON_SECRET || 'spirits-in-spacesuits';
  const material = `${day}|${salt}|${getIP(req)}|${req.headers.get('user-agent') || ''}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  return Array.from(new Uint8Array(digest))
    .slice(0, 10)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Referrers are stored as a bare host so the table never accumulates query strings
// (which can carry personal data from the referring site).
export function referrerHost(raw, selfHost) {
  if (!raw) return 'direct';
  try {
    const host = new URL(raw).hostname.replace(/^www\./, '');
    if (!host || (selfHost && host === selfHost.replace(/^www\./, ''))) return 'direct';
    return host.slice(0, 120);
  } catch {
    return 'direct';
  }
}
