// Seed dream_quotes table from the static JSON file
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/seed_dream_quotes.js

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const data = JSON.parse(readFileSync('public/quotes/dream-quotes.json', 'utf8'));
const quotes = data.quotes;

console.log(`Seeding ${quotes.length} dream quotes…`);

const rows = quotes.map((quote, i) => ({ quote, sort_order: i }));

// Supabase insert in batches of 100
for (let i = 0; i < rows.length; i += 100) {
  const batch = rows.slice(i, i + 100);
  const { error } = await supabase.from('dream_quotes').insert(batch);
  if (error) {
    console.error(`Error at batch ${i}:`, error.message);
    process.exit(1);
  }
  console.log(`  Inserted ${Math.min(i + 100, rows.length)} / ${rows.length}`);
}

console.log('Done!');
