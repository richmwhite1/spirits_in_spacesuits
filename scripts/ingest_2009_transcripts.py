#!/usr/bin/env python3
"""
Ingest 2009 sermon transcripts that contain an embedded YouTube URL on line 1.

File format:
  https://youtu.be/VIDEO_ID
  (blank line)
  Title
  (blank line)
  Content…

Usage:
    python3 scripts/ingest_2009_transcripts.py
    python3 scripts/ingest_2009_transcripts.py --dry-run
"""

import re, time, sys
from pathlib import Path
from supabase import create_client
import urllib.request, json as _json

# ── Config ───────────────────────────────────────────────────────────────────
REPO_ROOT   = Path(__file__).parent.parent
ENV_FILE    = REPO_ROOT / '.env.local'
BASE_DIR    = Path('/Users/richardwhite/Downloads/drive-download-20260522T173011Z-3-001')
SOURCE_TYPE = 'transcript'
CHUNK_SIZE  = 400
OVERLAP     = 80
BATCH_SIZE  = 50
EMBED_DIM   = 768

DRY_RUN = '--dry-run' in sys.argv

# ── Load env ──────────────────────────────────────────────────────────────────
def load_env(path):
    env = {}
    for line in Path(path).read_text().splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, _, v = line.partition('=')
            env[k.strip()] = v.strip()
    return env

env        = load_env(ENV_FILE)
sb         = create_client(env['SUPABASE_URL'], env['SUPABASE_SERVICE_KEY'])
GEMINI_KEY = env['GEMINI_API_KEY']

BATCH_URL = f'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:batchEmbedContents?key={GEMINI_KEY}'

# ── YouTube URL → video ID ────────────────────────────────────────────────────
YT_RE = re.compile(r'(?:youtu\.be/|youtube\.com/watch\?v=)([\w-]+)')

def extract_video_id(first_line: str) -> str | None:
    m = YT_RE.search(first_line.strip())
    return m.group(1) if m else None

# ── Filename → (title, date) ──────────────────────────────────────────────────
DATE_RE = re.compile(r'(\d{4}-\d{2}-\d{2}|\d{4})')

def parse_filename(stem: str) -> tuple[str, str | None]:
    stem = re.sub(r'^\(Final\s+Draft\)\s*', '', stem).strip()
    # Strip trailing "(1)", "(2)" etc. from duplicate files
    stem = re.sub(r'\s*\(\d+\)\s*$', '', stem).strip()
    m = DATE_RE.search(stem)
    date_str = None
    if m:
        raw = m.group(1)
        date_str = raw if len(raw) == 10 else f"{raw}-01-01"
        stem = stem[m.end():].strip().lstrip('- _').strip()
    title = re.sub(r'_+', ' ', stem).strip()
    title = re.sub(r'\s{2,}', ' ', title).lstrip('- ').strip()
    return title or stem, date_str

# ── Text pipeline ──────────────────────────────────────────────────────────────
def clean_text(text: str) -> str:
    lines = text.splitlines()
    # Drop the first YouTube URL line (and any immediately following blank line)
    if lines and YT_RE.search(lines[0]):
        lines = lines[1:]
        while lines and not lines[0].strip():
            lines = lines[1:]
    text = '\n'.join(lines)
    # Strip common transcript noise
    text = re.sub(r'\[Music\]', '', text, flags=re.IGNORECASE)
    text = re.sub(r'\[Applause\]', '', text, flags=re.IGNORECASE)
    text = re.sub(r'\[Laughter\]', '', text, flags=re.IGNORECASE)
    text = re.sub(r'\[\w+\]', '', text)
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

# ── Embed ──────────────────────────────────────────────────────────────────────
def embed_chunks(chunks: list[str]) -> list[list[float]]:
    embeddings = []
    for start in range(0, len(chunks), BATCH_SIZE):
        batch = chunks[start:start + BATCH_SIZE]
        payload = _json.dumps({
            'requests': [
                {
                    'model': 'models/gemini-embedding-2',
                    'content': {'parts': [{'text': c[:8000]}]},
                    'outputDimensionality': EMBED_DIM,
                }
                for c in batch
            ]
        }).encode()
        req = urllib.request.Request(
            BATCH_URL,
            data=payload,
            headers={'Content-Type': 'application/json'},
            method='POST',
        )
        with urllib.request.urlopen(req) as r:
            data = _json.loads(r.read())
        embeddings.extend([e['values'] for e in data['embeddings']])
        if start + BATCH_SIZE < len(chunks):
            time.sleep(0.2)
    return embeddings

# ── Supabase insert with retry ─────────────────────────────────────────────────
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

# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    if not BASE_DIR.exists():
        print(f"ERROR: Directory not found: {BASE_DIR}")
        sys.exit(1)

    if DRY_RUN:
        print("[DRY RUN — no data will be inserted]\n")

    txt_files = sorted(
        p for p in BASE_DIR.iterdir()
        if p.suffix == '.txt' and not p.name.startswith('.')
    )
    print(f"Found {len(txt_files)} .txt files in {BASE_DIR}\n")

    # Fetch existing titles to avoid duplicates
    print("Fetching existing transcript titles…")
    existing: set[str] = set()
    page_size = 1000
    offset = 0
    while True:
        result = sb.table('sean_chunks') \
            .select('source_title') \
            .eq('source_type', SOURCE_TYPE) \
            .range(offset, offset + page_size - 1) \
            .execute()
        for r in result.data:
            existing.add(r['source_title'])
        if len(result.data) < page_size:
            break
        offset += page_size
    print(f"  {len(existing)} transcript titles already in corpus.\n")

    total_inserted = 0
    total_skipped  = 0
    total_errors   = 0

    for fp in txt_files:
        title, date_str = parse_filename(fp.stem)

        if title in existing:
            print(f"  SKIP  {title[:75]}")
            total_skipped += 1
            continue

        raw_text = fp.read_text(encoding='utf-8', errors='replace')
        first_line = raw_text.splitlines()[0] if raw_text else ''
        video_id = extract_video_id(first_line)

        cleaned = clean_text(raw_text)
        chunks  = chunk_text(cleaned)

        if not chunks:
            print(f"  EMPTY {fp.name[:75]}")
            total_errors += 1
            continue

        yt_info = f"  yt={video_id}" if video_id else "  no YouTube URL"
        print(f"  →  {title[:60]}  ({len(chunks)} chunks, {date_str or 'no date'}){yt_info}")

        if DRY_RUN:
            total_inserted += 1
            continue

        try:
            embeddings = embed_chunks(chunks)

            rows = [
                {
                    'content':      chunk,
                    'embedding':    embeddings[i],
                    'source_type':  SOURCE_TYPE,
                    'source_title': title,
                    'source_id':    video_id,
                    'source_date':  date_str,
                    'chunk_index':  i,
                }
                for i, chunk in enumerate(chunks)
            ]

            for start in range(0, len(rows), 100):
                insert_rows(rows[start:start + 100])

            existing.add(title)
            total_inserted += 1
            print(f"     ✓ inserted")

        except Exception as e:
            print(f"     ✗ ERROR: {e}")
            total_errors += 1

    print()
    print('=' * 60)
    action = 'previewed' if DRY_RUN else 'inserted'
    print(f"DONE  —  {action}: {total_inserted}  skipped: {total_skipped}  errors: {total_errors}")
    print('=' * 60)

if __name__ == '__main__':
    main()
