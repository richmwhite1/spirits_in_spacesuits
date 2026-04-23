// Gemini embedding helper
// Uses text-embedding-004 — free under Google AI API quota, 768 dimensions

import { GoogleGenerativeAI } from '@google/generative-ai';

let _model = null;

function getModel() {
  if (!_model) {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    // text-embedding-004 requires v1 (not v1beta which is the SDK default)
    _model = genAI.getGenerativeModel(
      { model: 'text-embedding-004' },
      { apiVersion: 'v1' }
    );
  }
  return _model;
}

// Embed a single string — used at query time
export async function embedQuery(text) {
  const model = getModel();
  const result = await model.embedContent(text.slice(0, 8000));
  return result.embedding.values;
}

// Embed a batch of strings — used during ingestion
// Gemini batchEmbedContents handles up to 100 per call
export async function embedBatch(texts) {
  const model = getModel();
  const BATCH_SIZE = 100;
  const embeddings = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const result = await model.batchEmbedContents({
      requests: batch.map(text => ({
        content: { parts: [{ text: text.slice(0, 8000) }] }
      }))
    });
    embeddings.push(...result.embeddings.map(e => e.values));

    if (i + BATCH_SIZE < texts.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  return embeddings;
}

// chunkText lives in lib/parse.js — import from there for consistency
