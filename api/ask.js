// /api/ask — the Ask Seán RAG endpoint
// Flow: question → embed → vector search → Gemini with retrieved context → answer + citations
// Rate limited: 50 questions/IP/day (configurable via RATE_LIMIT_DAILY env var)

import { GoogleGenerativeAI } from '@google/generative-ai';
import { embedQuery } from '../lib/embed.js';
import { findRelevantChunks } from '../lib/supabase.js';
import { checkRateLimit, getIP, rateLimitResponse } from '../lib/rateLimit.js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Seán's system prompt — strict grounding, his voice, honest about limits
const SEAN_SYSTEM = `You are an AI built on Fr. Seán Ó'Laoire's complete body of work — his books, recorded teachings, and transcribed homilies. You speak in his voice and answer only from the material provided to you in each conversation.

CRITICAL RULES:
1. Answer ONLY from the source passages provided below. Do not draw on general knowledge or make inferences beyond what the text supports.
2. If the passages don't adequately address the question, say so honestly: "I don't find that addressed clearly in the material I have access to. You might explore [related topic] or ask Seán directly."
3. Quote directly from the passages where possible — use his actual words rather than paraphrasing.
4. At the end of every answer, list which sources you drew from using the format: [Source: Title, Date]
5. If someone asks something personal, biographical, or about current events, be clear: "This AI draws only from Seán's archived teachings. For current matters, please reach out to him directly."

TONE: Warm, direct, intellectually serious, occasionally wry. Irish cadence without parody. Never preachy. Willing to say "I don't know" or "the material doesn't address this clearly."

PURPOSE: This AI exists so that every person on earth — regardless of time zone, language, or background — can access fifty years of Seán's teaching as freely as if he were in the room.`;

export default async function handler(req) {
  // Only accept POST
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200 });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST required' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Rate limiting
  const ip = getIP(req);
  const { allowed, remaining } = await checkRateLimit(ip);
  if (!allowed) return rateLimitResponse();

  // Parse request
  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const { question, history = [] } = body;

  if (!question || typeof question !== 'string') {
    return new Response(JSON.stringify({ error: 'question is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Sanitise input — cap length, strip anything dangerous
  const cleanQuestion = question.trim().slice(0, 500);

  try {
    // 1. Embed the question
    const queryEmbedding = await embedQuery(cleanQuestion);

    // 2. Retrieve the 12 most relevant chunks from Supabase, then filter by quality
    const rawChunks = await findRelevantChunks(queryEmbedding, 12);
    const chunks = rawChunks.filter(c => c.similarity > 0.35).slice(0, 8);

    if (chunks.length === 0) {
      return new Response(JSON.stringify({
        answer: rawChunks.length === 0
          ? "I don't have enough material in the archive yet to answer that well. As more of Seán's transcripts are added, this will improve. In the meantime, you might find relevant teaching in his video archive."
          : "I can't find a clear answer to that in Seán's archive. The question may not have been addressed directly in the recorded material I have access to. You might explore related topics or ask Seán directly.",
        sources: [],
        remaining
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 3. Build context block from retrieved chunks
    const context = chunks.map((c, i) => (
      `[Passage ${i + 1}]\n` +
      `Source: ${c.source_title}${c.source_date ? ` (${c.source_date})` : ''}\n` +
      `Type: ${c.source_type}\n` +
      `${c.source_id ? `Video ID: ${c.source_id}\n` : ''}` +
      `---\n${c.content}`
    )).join('\n\n');

    // 4. Build conversation history (cap at last 6 turns to control costs)
    const recentHistory = history.slice(-6).map(turn => ({
      role: turn.role,
      content: turn.content.slice(0, 800) // Cap each turn
    }));

    // 5. Call Gemini — 1200 tokens allows full, nuanced answers for layered spiritual questions
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: SEAN_SYSTEM,
      generationConfig: { maxOutputTokens: 1200, temperature: 0 }
    });

    const geminiHistory = recentHistory.map(turn => ({
      role: turn.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: turn.content }]
    }));

    const chat = model.startChat({ history: geminiHistory });
    const result = await chat.sendMessage(
      `Here are the most relevant passages from Seán's archive for this question:\n\n${context}\n\n---\n\nQuestion: ${cleanQuestion}`
    );

    const answer = result.response.text() || 'Something went wrong. Please try again.';

    // 6. Build source citations for the UI
    const sources = chunks
      .filter(c => c.similarity > 0.3)
      .slice(0, 4)
      .map(c => ({
        title: c.source_title,
        date: c.source_date,
        type: c.source_type,
        videoId: c.source_id || null,
        similarity: Math.round(c.similarity * 100)
      }));

    // 7. Related videos — unique YouTube IDs from transcript chunks above threshold
    const relatedVideos = [];
    const seen = new Set();
    for (const c of chunks) {
      if (c.source_type === 'transcript' && c.source_id && c.similarity > 0.3 && !seen.has(c.source_id)) {
        seen.add(c.source_id);
        relatedVideos.push({ id: c.source_id, title: c.source_title });
        if (relatedVideos.length >= 3) break;
      }
    }

    return new Response(JSON.stringify({ answer, sources, relatedVideos, remaining }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error('/api/ask error:', err.message);
    return new Response(JSON.stringify({
      error: 'Something went wrong',
      message: 'The archive is temporarily unavailable. Please try again in a moment.'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export const config = { runtime: 'edge' };
