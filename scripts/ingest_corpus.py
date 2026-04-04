#!/usr/bin/env python3
"""
Batch ingest corpus .txt files into sean_chunks (RAG knowledge base).
Replicates the same clean → chunk → embed → store pipeline as /api/admin/upload.js

Usage: python3 scripts/ingest_corpus.py
"""

import re, time, sys
from pathlib import Path
from supabase import create_client
from openai import OpenAI

# ── Config ──────────────────────────────────────────────────────────────────
REPO_ROOT   = Path(__file__).parent.parent
ENV_FILE    = REPO_ROOT / '.env.local'
BASE_DIR    = Path('/Users/richardwhite/Downloads/drive-download-20260404T033635Z-3-001')
YEARS       = ['2007','2008','2019','2020','2021','2022','2023','2024','2025']
CHUNK_SIZE  = 400   # words
OVERLAP     = 80    # words
BATCH_SIZE  = 50    # embeddings per OpenAI call

# ── Load env ─────────────────────────────────────────────────────────────────
def load_env(path):
    env = {}
    for line in Path(path).read_text().splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, _, v = line.partition('=')
            env[k.strip()] = v.strip()
    return env

env     = load_env(ENV_FILE)
sb      = create_client(env['SUPABASE_URL'], env['SUPABASE_SERVICE_KEY'])
openai  = OpenAI(api_key=env['OPENAI_API_KEY'])

# ── Text pipeline (mirrors lib/parse.js) ────────────────────────────────────
def clean_transcript(text: str) -> str:
    # Strip SRT artifacts
    text = re.sub(r'^\d+\s*$', '', text, flags=re.MULTILINE)
    text = re.sub(r'^\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d{3}.*$', '', text, flags=re.MULTILINE)
    text = re.sub(r'^WEBVTT.*$', '', text, flags=re.MULTILINE)
    text = re.sub(r'^NOTE\b.*$', '', text, flags=re.MULTILINE)
    # Remove noise
    text = re.sub(r'\[Music\]', '', text, flags=re.IGNORECASE)
    text = re.sub(r'\[Applause\]', '', text, flags=re.IGNORECASE)
    text = re.sub(r'\[Laughter\]', '', text, flags=re.IGNORECASE)
    text = re.sub(r'\[\w+\]', '', text)
    # Normalise whitespace
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()

def chunk_text(text: str) -> list[str]:
    words = text.split()
    chunks = []
    i = 0
    while i < len(words):
        chunk = ' '.join(words[i:i + CHUNK_SIZE])
        if len(chunk.strip()) > 80:
            chunks.append(chunk)
        if i + CHUNK_SIZE >= len(words):
            break
        i += CHUNK_SIZE - OVERLAP
    return chunks

# ── Filename → (title, date) ─────────────────────────────────────────────────
DATE_RE = re.compile(r'(\d{4}-\d{2}-\d{2}|\d{4})')

def parse_filename(stem: str) -> tuple[str, str | None]:
    """Extract a clean title and ISO date from filename stem."""
    # Remove "(Final Draft)" / "(Final  Draft)" prefix
    stem = re.sub(r'^\(Final\s+Draft\)\s*', '', stem).strip()

    # Extract date
    m = DATE_RE.search(stem)
    date_str = None
    if m:
        raw = m.group(1)
        date_str = raw if len(raw) == 10 else f"{raw}-01-01"
        # Remove date + surrounding separators from title
        stem = stem[m.end():].strip().lstrip('- _').strip()
    else:
        stem = stem.strip()

    # Clean up title: replace _ with space, collapse spaces, strip trailing punctuation oddities
    title = re.sub(r'_+', ' ', stem).strip()
    title = re.sub(r'\s{2,}', ' ', title)
    # Remove a stray leading dash
    title = title.lstrip('- ').strip()

    return title or stem, date_str

# ── Embed a batch of text chunks ─────────────────────────────────────────────
def embed_chunks(chunks: list[str]) -> list[list[float]]:
    embeddings = []
    for start in range(0, len(chunks), BATCH_SIZE):
        batch = chunks[start:start + BATCH_SIZE]
        resp = openai.embeddings.create(
            model='text-embedding-3-small',
            input=[c[:8000] for c in batch]
        )
        embeddings.extend([d.embedding for d in resp.data])
        if start + BATCH_SIZE < len(chunks):
            time.sleep(0.2)   # avoid rate limits
    return embeddings

# ── Supabase insert with retry ────────────────────────────────────────────────
def insert_rows(rows: list[dict]) -> None:
    for attempt in range(3):
        try:
            sb.table('sean_chunks').insert(rows).execute()
            return
        except Exception as e:
            if attempt < 2:
                print(f"    Retry {attempt+1}…")
                time.sleep(2)
            else:
                raise

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    # Fetch all existing source_titles to skip duplicates
    print("Fetching existing corpus titles…")
    result = sb.table('sean_chunks').select('source_title').execute()
    existing = {r['source_title'] for r in result.data}
    print(f"  {len(existing)} unique titles already in corpus.\n")

    total_files    = 0
    total_inserted = 0
    total_skipped  = 0
    total_errors   = 0

    for year in YEARS:
        year_dir = BASE_DIR / year
        if not year_dir.exists():
            print(f"[SKIP] {year} directory not found")
            continue

        txt_files = sorted(p for p in year_dir.iterdir()
                           if p.suffix == '.txt' and not p.name.startswith('.'))

        print(f"{'='*60}")
        print(f"  {year}  —  {len(txt_files)} files")
        print(f"{'='*60}")

        for fp in txt_files:
            total_files += 1
            title, date_str = parse_filename(fp.stem)

            if title in existing:
                print(f"  SKIP  {title[:70]}")
                total_skipped += 1
                continue

            text = fp.read_text(encoding='utf-8', errors='replace')
            cleaned = clean_transcript(text)
            chunks  = chunk_text(cleaned)

            if not chunks:
                print(f"  EMPTY {fp.name[:70]}")
                total_errors += 1
                continue

            print(f"  →  {title[:65]}  ({len(chunks)} chunks, {date_str or 'no date'})")

            try:
                embeddings = embed_chunks(chunks)

                rows = [
                    {
                        'content':      chunk,
                        'embedding':    embeddings[i],
                        'source_type':  'transcript',
                        'source_title': title,
                        'source_id':    None,
                        'source_date':  date_str,
                        'chunk_index':  i,
                    }
                    for i, chunk in enumerate(chunks)
                ]

                # Insert in batches of 100
                for start in range(0, len(rows), 100):
                    insert_rows(rows[start:start + 100])

                existing.add(title)
                total_inserted += 1
                print(f"     ✓ inserted")

            except Exception as e:
                print(f"     ✗ ERROR: {e}")
                total_errors += 1

        print()

    print('='*60)
    print(f"DONE  —  files: {total_files}  inserted: {total_inserted}  skipped: {total_skipped}  errors: {total_errors}")
    print('='*60)

if __name__ == '__main__':
    main()
