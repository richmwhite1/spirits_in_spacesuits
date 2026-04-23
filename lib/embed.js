// Gemini embedding helper
// Uses gemini-embedding-2 with 768 output dimensions (fits IVFFlat index limit of 2000)

const GEMINI_EMBED_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent';
const GEMINI_BATCH_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:batchEmbedContents';
const OUTPUT_DIM = 768;

async function fetchEmbed(text) {
  const res = await fetch(`${GEMINI_EMBED_URL}?key=${process.env.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: { parts: [{ text: text.slice(0, 8000) }] },
      outputDimensionality: OUTPUT_DIM
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(`Embedding failed: ${data.error.message}`);
  return data.embedding.values;
}

// Embed a single string — used at query time
export async function embedQuery(text) {
  return fetchEmbed(text);
}

// Embed a batch of strings — used during ingestion
export async function embedBatch(texts) {
  const BATCH_SIZE = 100;
  const embeddings = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const res = await fetch(`${GEMINI_BATCH_URL}?key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: batch.map(text => ({
          model: 'models/gemini-embedding-2',
          content: { parts: [{ text: text.slice(0, 8000) }] },
          outputDimensionality: OUTPUT_DIM
        }))
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(`Batch embedding failed: ${data.error.message}`);
    embeddings.push(...data.embeddings.map(e => e.values));

    if (i + BATCH_SIZE < texts.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  return embeddings;
}

// chunkText lives in lib/parse.js — import from there for consistency
