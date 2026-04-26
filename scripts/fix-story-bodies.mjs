// One-time script: cleans up story bodies in the database
// - Strips the repeated title from the start of the body
// - Removes leading/trailing empty <p> tags
// - Fixes \n literal escape sequences
// Run: SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/fix-story-bodies.mjs

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function stripHtmlTags(s) {
  return s.replace(/<[^>]+>/g, '');
}

function normalise(s) {
  return s.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function stripTitleFromBody(body, title) {
  if (!body || !title) return body;

  const tn = normalise(title);

  // Case 1: body starts with <p>Title</p> or <p>Title<br>...</p>
  // Find the first <p>...</p> block and check if its text matches the title
  const firstParaMatch = body.match(/^(<p>)([\s\S]*?)(<\/p>)/i);
  if (firstParaMatch) {
    const innerText = stripHtmlTags(firstParaMatch[2]);
    // Check if first line of the paragraph is the title
    const firstLine = innerText.split(/\n|<br>/i)[0].trim();
    if (normalise(firstLine) === tn) {
      // Remove just the title text and any following <br> tags
      let newInner = firstParaMatch[2]
        .replace(new RegExp(`^${escapeRegex(firstLine)}\\s*(<br\\s*/?>\\s*)*`, 'i'), '')
        .trim();
      if (!stripHtmlTags(newInner).trim()) {
        // Whole first paragraph was just the title — remove it entirely
        body = body.slice(firstParaMatch[0].length).trimStart();
      } else {
        body = firstParaMatch[1] + newInner + firstParaMatch[3] + body.slice(firstParaMatch[0].length);
      }
    }
  }

  // Case 2: plain text at the very start (no HTML on first line)
  if (!body.trimStart().startsWith('<')) {
    const firstLine = body.split('\n')[0].trim();
    if (normalise(firstLine) === tn) {
      body = body.slice(firstLine.length).replace(/^[\n\r]+/, '');
    }
  }

  // Clean up: remove any leading empty <p></p> blocks
  body = body.replace(/^(\s*<p>\s*<\/p>\s*)+/, '').trim();

  return body;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fixLiteralNewlines(body) {
  // Replace literal \n (two characters) with actual newline
  return body.replace(/\\n/g, '\n');
}

async function run() {
  console.log('Fetching all stories…');
  const { data: stories, error } = await supabase
    .from('stories')
    .select('id, title, body')
    .order('sort_order');

  if (error) { console.error('Fetch failed:', error.message); process.exit(1); }
  console.log(`Found ${stories.length} stories.\n`);

  let fixed = 0;
  for (const s of stories) {
    let body = s.body || '';
    const original = body;

    // Fix literal \n
    body = fixLiteralNewlines(body);

    // Strip title from body
    body = stripTitleFromBody(body, s.title);

    if (body !== original) {
      console.log(`Fixing: "${s.title}"`);
      const { error: updateError } = await supabase
        .from('stories')
        .update({ body })
        .eq('id', s.id);
      if (updateError) {
        console.error(`  Error updating ${s.title}:`, updateError.message);
      } else {
        console.log(`  ✓ Updated`);
        fixed++;
      }
    }
  }

  console.log(`\nDone. Fixed ${fixed} of ${stories.length} stories.`);
}

run().catch(console.error);
