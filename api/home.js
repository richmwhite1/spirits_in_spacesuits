// /api/home — combined homepage payload
// Bundles the 7 fast Supabase-only sections the homepage needs on first paint into a
// single response, so the page makes one request instead of ~8. Mirrors the public GET
// query in each individual endpoint (stories?today=1, models, glossary, books, courses,
// events, testimonials, dream-quotes?today=1). Each section is gathered independently via
// Promise.allSettled, so one failing query degrades only its own section — never the page.
//
// Videos/stats stay on /api/videos: they hit YouTube + Gemini (slower, external) and are
// kept separate to preserve fault-isolation and progressive rendering.

import { getSupabase } from '../lib/supabase.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const CACHE = 'public, s-maxage=86400, stale-while-revalidate=604800';

// Deterministic "item of the day" index — identical to the ?today=1 logic in
// api/stories.js and api/dream-quotes.js.
function dayIndex(count) {
  const now = new Date();
  const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
  return dayOfYear % count;
}

async function todayFrom(supabase, table) {
  const { count } = await supabase.from(table).select('*', { count: 'exact', head: true });
  if (!count) return null;
  const { data } = await supabase
    .from(table).select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
    .range(dayIndex(count), dayIndex(count));
  return data?.[0] ?? null;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200 });
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: JSON_HEADERS });
  }

  const supabase = getSupabase();
  const today = new Date().toISOString().split('T')[0];

  const tasks = {
    todayStory: () => todayFrom(supabase, 'stories'),
    dreamQuote: () => todayFrom(supabase, 'dream_quotes'),
    models: async () => (await supabase.from('models').select('*')
      .order('sort_order', { ascending: true }).order('created_at', { ascending: true })).data ?? [],
    books: async () => (await supabase.from('books').select('*')
      .order('sort_order', { ascending: true }).order('created_at', { ascending: true })).data ?? [],
    courses: async () => (await supabase.from('courses').select('*')
      .order('sort_order', { ascending: true }).order('created_at', { ascending: true })).data ?? [],
    glossary: async () => (await supabase.from('glossary').select('*')
      .order('term', { ascending: true })).data ?? [],
    events: async () => (await supabase.from('events').select('*')
      .order('event_date', { ascending: true }).gte('event_date', today)).data ?? [],
    testimonials: async () => (await supabase.from('testimonials')
      .select('id, name, location, message, created_at')
      .eq('approved', true).order('created_at', { ascending: false })).data ?? [],
  };

  const keys = Object.keys(tasks);
  const settled = await Promise.allSettled(keys.map(k => tasks[k]()));

  // Defaults match each section's "empty" shape so the client can render unconditionally.
  const empties = { todayStory: null, dreamQuote: null, models: [], books: [], courses: [], glossary: [], events: [], testimonials: [] };
  const out = {};
  keys.forEach((k, i) => {
    out[k] = settled[i].status === 'fulfilled' ? settled[i].value : empties[k];
  });

  // Match the /api/glossary response shape: { terms: [...] }
  out.glossary = { terms: out.glossary };

  return new Response(JSON.stringify(out), {
    headers: { ...JSON_HEADERS, 'Cache-Control': CACHE }
  });
}

export const config = { runtime: 'edge' };
