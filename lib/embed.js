// OpenAI embedding helper
// Uses text-embedding-3-small — cheap (~$0.02/million tokens) and accurate
// The entire Sean corpus will cost well under $5 to embed once

import OpenAI from 'openai';

let _openai = null;

function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

// Embed a single string — used at query time
export async function embedQuery(text) {
  const openai = getOpenAI();
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text.slice(0, 8000) // Safety cap
  });
  return response.data[0].embedding;
}

// Embed a batch of strings — used during ingestion
// Batches of 100 to stay within API limits
export async function embedBatch(texts) {
  const openai = getOpenAI();
  const BATCH_SIZE = 100;
  const embeddings = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: batch.map(t => t.slice(0, 8000))
    });
    embeddings.push(...response.data.map(d => d.embedding));

    // Small delay between batches to be polite to the API
    if (i + BATCH_SIZE < texts.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  return embeddings;
}

// chunkText lives in lib/parse.js — import from there for consistency
