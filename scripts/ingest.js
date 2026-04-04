#!/usr/bin/env node
// Ingestion script — chunks, embeds, and stores text into Supabase pgvector
//
// Usage:
//   node scripts/ingest.js --source=transcripts --dir=./data/transcripts
//   node scripts/ingest.js --source=books      --dir=./data/books
//   node scripts/ingest.js --file=./data/transcripts/some_video.txt --title="Video Title" --id=youtubeId --date=2024-03-15
//
// Drop transcript .txt files into data/transcripts/ named as: videoId_title.txt
// Drop book text files into data/books/ named as: book_slug.txt
//
// This runs LOCALLY — not on Vercel. It's a one-time (and repeatable) setup step.
// For new content: just add the file and re-run. It checks for duplicates.

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, basename, extname } from 'path';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { config } from 'dotenv';
import { cleanTranscript, chunkText as parseChunkText } from '../lib/parse.js';

config({ path: join(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Parse command line args
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => a.slice(2).split('='))
);

const SOURCE = args.source || 'transcripts';
const DIR = args.dir || `./data/${SOURCE}`;
const SINGLE_FILE = args.file || null;
const CHUNK_SIZE = 400;   // words per chunk
const OVERLAP = 80;       // word overlap between chunks
const BATCH_SIZE = 50;    // chunks to embed at once

async function main() {
  console.log(`\n🌌 Spirits in Spacesuits — RAG Ingestion`);
  console.log(`Source: ${SOURCE}`);
  console.log(`─────────────────────────────────────\n`);

  const filesToProcess = [];

  if (SINGLE_FILE) {
    filesToProcess.push({
      path: SINGLE_FILE,
      title: args.title || basename(SINGLE_FILE, extname(SINGLE_FILE)),
      sourceId: args.id || null,
      date: args.date || null,
      sourceType: SOURCE
    });
  } else {
    if (!existsSync(DIR)) {
      console.error(`Directory not found: ${DIR}`);
      console.log(`Create it and add .txt files:`);
      console.log(`  mkdir -p ${DIR}`);
      process.exit(1);
    }

    const files = readdirSync(DIR).filter(f => f.endsWith('.txt'));
    console.log(`Found ${files.length} files in ${DIR}\n`);

    for (const file of files) {
      // Expected filename format: videoId_Title_of_video.txt
      // or for books: book-slug_Title.txt
      const parts = basename(file, '.txt').split('_');
      const sourceId = SOURCE === 'transcripts' ? parts[0] : null;
      const title = parts.slice(SOURCE === 'transcripts' ? 1 : 0).join(' ').replace(/-/g, ' ');

      filesToProcess.push({
        path: join(DIR, file),
        title: title || file,
        sourceId,
        date: null, // Will try to extract from content or filename
        sourceType: SOURCE === 'books' ? 'book' : 'transcript'
      });
    }
  }

  let totalChunks = 0;
  let skipped = 0;

  for (const fileInfo of filesToProcess) {
    const result = await ingestFile(fileInfo);
    if (result.skipped) {
      skipped++;
    } else {
      totalChunks += result.chunks;
    }
  }

  console.log(`\n─────────────────────────────────────`);
  console.log(`✅ Done!`);
  console.log(`   Files processed: ${filesToProcess.length - skipped}`);
  console.log(`   Files skipped (already ingested): ${skipped}`);
  console.log(`   Total new chunks stored: ${totalChunks}`);
  console.log(`\nThe RAG corpus is ready.\n`);
}

async function ingestFile({ path, title, sourceId, date, sourceType }) {
  // Check if already ingested (by source_title + source_type)
  const { data: existing } = await supabase
    .from('sean_chunks')
    .select('id')
    .eq('source_title', title)
    .eq('source_type', sourceType)
    .limit(1);

  if (existing && existing.length > 0) {
    console.log(`  ⏭  Skipping "${title}" (already in corpus)`);
    return { skipped: true };
  }

  console.log(`  📄 Processing: "${title}"`);

  const raw = readFileSync(path, 'utf-8');
  const text = cleanTranscript(raw);
  const chunks = parseChunkText(text, CHUNK_SIZE, OVERLAP);
  console.log(`     ${chunks.length} chunks`);

  // Embed in batches
  const allEmbeddings = [];
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    process.stdout.write(`     Embedding ${i}–${Math.min(i + BATCH_SIZE, chunks.length)}/${chunks.length}...`);

    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: batch.map(c => c.slice(0, 8000))
    });

    allEmbeddings.push(...response.data.map(d => d.embedding));
    process.stdout.write(' ✓\n');

    // Rate limiting courtesy pause
    if (i + BATCH_SIZE < chunks.length) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  // Store in Supabase
  const rows = chunks.map((content, idx) => ({
    content,
    embedding: allEmbeddings[idx],
    source_type: sourceType,
    source_title: title,
    source_id: sourceId,
    source_date: date,
    chunk_index: idx
  }));

  // Insert in batches of 100 (Supabase limit)
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await supabase
      .from('sean_chunks')
      .insert(rows.slice(i, i + 100));

    if (error) {
      console.error(`\n  ❌ Insert error: ${error.message}`);
      return { chunks: 0 };
    }
  }

  console.log(`     ✅ Stored ${chunks.length} chunks\n`);
  return { chunks: chunks.length };
}

main().catch(err => {
  console.error('\n❌ Ingestion failed:', err.message);
  process.exit(1);
});
