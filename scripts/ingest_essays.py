#!/usr/bin/env python3
"""
Ingest essays, stories and poems from a flat .txt directory into sean_chunks.
Uses the same clean → chunk → embed → store pipeline as ingest_corpus.py.

Usage:
    python3 scripts/ingest_essays.py
    python3 scripts/ingest_essays.py --dir=/path/to/folder
    python3 scripts/ingest_essays.py --dry-run
"""

import re, time, sys, argparse
from pathlib import Path
from supabase import create_client
import urllib.request, json as _json

# ── Config ───────────────────────────────────────────────────────────────────
REPO_ROOT   = Path(__file__).parent.parent
ENV_FILE    = REPO_ROOT / '.env.local'
DEFAULT_DIR = Path('/Users/richardwhite/Downloads/docs/essays, stories and poems txt')
SOURCE_TYPE = 'essay'
CHUNK_SIZE  = 400   # words
OVERLAP     = 80    # words
BATCH_SIZE  = 50    # embeddings per Gemini call
EMBED_DIM   = 768   # gemini-embedding-2 output dimensions

# ── Args ─────────────────────────────────────────────────────────────────────
parser = argparse.ArgumentParser()
parser.add_argument('--dir', default=str(DEFAULT_DIR))
parser.add_argument('--dry-run', action='store_true', help='Preview without inserting')
args = parser.parse_args()

BASE_DIR = Path(args.dir)
DRY_RUN  = args.dry_run

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

# ── Text pipeline ─────────────────────────────────────────────────────────────
def clean_text(text: str) -> str:
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

# ── Embed via Gemini ──────────────────────────────────────────────────────────
BATCH_URL = f'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:batchEmbedContents?key={GEMINI_KEY}'

def embed_chunks(chunks: list[str]) -> list[list[float]]:
    embeddings = []
    for start in range(0, len(chunks), BATCH_SIZE):
        batch = chunks[start:start + BATCH_SIZE]
        payload = _json.dumps({
            'requests': [
                {
                    'model': 'models/gemini-embedding-2',
                    'content': {'parts': [{'text': c[:8000]}]},
                    'outputDimensionality': EMBED_DIM
                }
                for c in batch
            ]
        }).encode()
        req = urllib.request.Request(
            BATCH_URL,
            data=payload,
            headers={'Content-Type': 'application/json'},
            method='POST'
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

    txt_files = sorted(
        p for p in BASE_DIR.iterdir()
        if p.suffix == '.txt' and not p.name.startswith('.')
    )
    print(f"Found {len(txt_files)} .txt files in {BASE_DIR}\n")

    if DRY_RUN:
        print("[DRY RUN — no data will be inserted]\n")

    # Fetch existing titles for dedup
    print("Fetching existing corpus titles…")
    result = sb.table('sean_chunks').select('source_title').eq('source_type', SOURCE_TYPE).execute()
    existing = {r['source_title'] for r in result.data}
    print(f"  {len(existing)} essay titles already in corpus.\n")

    total_inserted = 0
    total_skipped  = 0
    total_errors   = 0

    for fp in txt_files:
        title = fp.stem  # use filename without extension as-is

        if title in existing:
            print(f"  SKIP  {title[:75]}")
            total_skipped += 1
            continue

        text    = fp.read_text(encoding='utf-8', errors='replace')
        cleaned = clean_text(text)
        chunks  = chunk_text(cleaned)

        if not chunks:
            print(f"  EMPTY {fp.name[:75]}")
            total_errors += 1
            continue

        print(f"  →  {title[:65]}  ({len(chunks)} chunk{'s' if len(chunks) != 1 else ''})")

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
                    'source_id':    None,
                    'source_date':  None,
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
