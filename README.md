# Spirits in Spacesuits — Technical Setup Guide

Fr. Seán Ó'Laoire's complete archive: Ask Seán AI + Video Library + Stories

---

## Stack

| Layer | Service | Cost |
|-------|---------|------|
| Frontend + API | Vercel | Free |
| Vector DB | Supabase pgvector | Free |
| Embeddings | OpenAI text-embedding-3-small | ~$3 one-time |
| AI answers | Anthropic Claude API | ~$0.003/answer |
| Video feed | YouTube Data API v3 | Free (10k/day) |
| Domain | Your existing domain | ~$12/year |

---

## Initial Setup (one time)

### 1. Supabase

1. Create a project at supabase.com (free tier)
2. Go to SQL Editor → paste the entire SQL block from `lib/supabase.js`
3. Run it — this creates the `sean_chunks` table, vector index, and rate limit functions
4. Copy your project URL and service key from Settings → API

### 2. Vercel

```bash
npm install -g vercel
vercel login
vercel --prod
```

### 3. Environment Variables

Copy `.env.example` to `.env.local` and fill in all values.

In Vercel dashboard: Settings → Environment Variables → add all of them.

Required:
- `ANTHROPIC_API_KEY` — from console.anthropic.com
- `OPENAI_API_KEY` — from platform.openai.com
- `SUPABASE_URL` — from Supabase project settings
- `SUPABASE_SERVICE_KEY` — from Supabase project settings
- `YOUTUBE_API_KEY` — from console.cloud.google.com → YouTube Data API v3
- `ADMIN_SECRET` — any long random string you choose

### 4. Background image

Place `Gemini_Generated_Image_nv2no7nv2no7nv2n.png` in the `/public` folder.

---

## Ingesting the Corpus

### Transcripts

1. Create `data/transcripts/` folder
2. Name each file: `youtubeVideoId_Title_of_video.txt`
   - Example: `eKRx8Wh-qeM_Spiritual_Battle_For_Humanitys_Soul.txt`
3. Run:
```bash
node scripts/ingest.js --source=transcripts --dir=./data/transcripts
```

### Books (when PDFs arrive)

1. Extract text from PDF (any PDF-to-text tool works)
2. Save as `.txt` in `data/books/`
3. Name: `book-slug_Full_Title.txt`
   - Example: `setting-god-free_Setting_God_Free.txt`
4. Run:
```bash
node scripts/ingest.js --source=books --dir=./data/books
```

### Adding new content over time

Just drop a new `.txt` file in the appropriate folder and re-run the ingest script.
It checks for duplicates — existing content is never re-embedded.

---

## YouTube API Setup (5 minutes)

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (or use existing)
3. Enable "YouTube Data API v3"
4. Create credentials → API Key
5. Add to environment variables as `YOUTUBE_API_KEY`

The site will then auto-populate:
- Latest appearances (podcast interviews detected automatically)
- Full video library with search
- No manual updates ever needed

---

## Rate Limiting

The Ask Seán AI is protected against abuse:
- **50 questions per IP per day** (configurable via `RATE_LIMIT_DAILY`)
- **600 token max per answer** (cost control)
- **Vercel DDoS protection** at infrastructure level
- Friendly message shown when limit is reached — no hard errors

To change the daily limit: update `RATE_LIMIT_DAILY` in Vercel environment variables.

---

## Adding Stories

Open `public/index.html` → find the `STORIES` array in the JavaScript section.

Each story follows this pattern:
```js
{
  title: 'Story Title',
  excerpt: 'First sentence or two for the card preview.',
  body: `<p>Full HTML content of the story.</p><p>Multiple paragraphs fine.</p>`
}
```

Add new objects at the top of the array (newest first).

---

## Project Structure

```
spirits-vercel/
├── api/
│   ├── ask.js          ← Ask Seán RAG endpoint
│   └── videos.js       ← YouTube Data API proxy
├── lib/
│   ├── rateLimit.js    ← IP-based rate limiting
│   ├── supabase.js     ← Vector search + DB helpers
│   └── embed.js        ← OpenAI embedding helpers
├── scripts/
│   └── ingest.js       ← Run locally to ingest transcripts/books
├── public/
│   └── index.html      ← The full website
├── data/               ← Create locally, never committed to git
│   ├── transcripts/    ← .txt transcript files
│   └── books/          ← .txt book files
├── .env.example        ← Copy to .env.local
├── vercel.json         ← Vercel routing config
└── package.json
```

---

## What's Not in the Admin Panel (intentionally)

- **Video feed** — auto-populated from YouTube, zero maintenance
- **Latest appearances** — auto-detected from channel, zero maintenance
- **RAG corpus** — updated by running ingest.js locally (by design — you control what goes in)
- **Books** — same as corpus

**Admin panel handles:** Stories (add/edit/toggle) and Models/Visual aids.
Everything structural is handled in conversation with Claude.
