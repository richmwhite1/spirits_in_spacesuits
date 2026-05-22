#!/usr/bin/env python3
"""
Insert Patheos essays into the `stories` table for website display.
Also fixes the two corpus entries that were ingested with bad titles ("3" and "7").

Usage:
    python3 scripts/ingest_stories_display.py
    python3 scripts/ingest_stories_display.py --dry-run
"""

import re, sys, argparse, time, json as _json, urllib.request
from pathlib import Path
from supabase import create_client

REPO_ROOT   = Path(__file__).parent.parent
ENV_FILE    = REPO_ROOT / '.env.local'
PATHEOS_DIR = Path('/Users/richardwhite/Downloads/Patheos For Richard')

# These two originals had no .txt extension; their content is in /tmp/patheos_txt
EXTRA_FILES = {
    '3. Nurturing 2016': Path('/tmp/patheos_txt/3.txt'),
    '7. Shall we dream': Path('/tmp/patheos_txt/7.txt'),
}

CHUNK_SIZE = 400
OVERLAP    = 80
BATCH_SIZE = 50
EMBED_DIM  = 768

parser = argparse.ArgumentParser()
parser.add_argument('--dry-run', action='store_true')
args = parser.parse_args()
DRY_RUN = args.dry_run

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

# ── Helpers ───────────────────────────────────────────────────────────────────
def clean_title(stem):
    """Strip leading sort number like '10. ' or '20 '."""
    return re.sub(r'^\d+\.?\s*', '', stem).strip()

def get_excerpt(text, max_chars=300):
    for para in re.split(r'\n{2,}', text):
        para = para.strip()
        if len(para) > 40:
            return (para[:max_chars] + '…') if len(para) > max_chars else para
    return text[:max_chars]

def chunk_text(text):
    words = text.split()
    chunks, i = [], 0
    while i < len(words):
        chunk = ' '.join(words[i:i + CHUNK_SIZE])
        if len(chunk.strip()) > 80:
            chunks.append(chunk)
        if i + CHUNK_SIZE >= len(words):
            break
        i += CHUNK_SIZE - OVERLAP
    return chunks

def embed_chunks(chunks):
    embeddings = []
    for start in range(0, len(chunks), BATCH_SIZE):
        batch = chunks[start:start + BATCH_SIZE]
        payload = _json.dumps({
            'requests': [
                {'model': 'models/gemini-embedding-2',
                 'content': {'parts': [{'text': c[:8000]}]},
                 'outputDimensionality': EMBED_DIM}
                for c in batch
            ]
        }).encode()
        req = urllib.request.Request(BATCH_URL, data=payload,
                                     headers={'Content-Type': 'application/json'}, method='POST')
        with urllib.request.urlopen(req) as r:
            data = _json.loads(r.read())
        embeddings.extend([e['values'] for e in data['embeddings']])
        if start + BATCH_SIZE < len(chunks):
            time.sleep(0.2)
    return embeddings

# ── Collect files ─────────────────────────────────────────────────────────────
files = {}  # clean_title -> (raw_title, path)
for fp in sorted(PATHEOS_DIR.glob('*.txt')):
    raw   = fp.stem
    title = clean_title(raw)
    files[title] = (raw, fp)

for raw_title, fp in EXTRA_FILES.items():
    if fp.exists():
        title = clean_title(raw_title)
        files[title] = (raw_title, fp)

print(f"Found {len(files)} essays to process\n")
if DRY_RUN:
    print("[DRY RUN — no data will be written]\n")

# ── Check existing stories ────────────────────────────────────────────────────
print("Checking existing stories table…")
result = sb.table('stories').select('title').eq('content_type', 'essay').execute()
existing_stories = {r['title'] for r in result.data}
print(f"  {len(existing_stories)} essays already in stories table.\n")

# ── Fix bad corpus entries ("3" and "7") ──────────────────────────────────────
print("Checking corpus for bad-titled entries…")
bad_corpus = {'3': '3. Nurturing 2016', '7': '7. Shall we dream'}
existing_corpus = {r['source_title'] for r in
                   sb.table('sean_chunks').select('source_title').eq('source_type', 'essay').execute().data}

for bad_title, proper_raw in bad_corpus.items():
    proper_clean = clean_title(proper_raw)
    if bad_title in existing_corpus:
        print(f"  Removing bad corpus entry '{bad_title}'…")
        if not DRY_RUN:
            sb.table('sean_chunks').delete()\
              .eq('source_type', 'essay').eq('source_title', bad_title).execute()
        # Re-ingest with proper title
        fp = EXTRA_FILES.get(proper_raw)
        if fp and fp.exists():
            text   = fp.read_text(encoding='utf-8', errors='replace').strip()
            chunks = chunk_text(text)
            print(f"  Re-ingesting as '{proper_raw}' ({len(chunks)} chunks)…")
            if not DRY_RUN:
                embeddings = embed_chunks(chunks)
                rows = [
                    {'content': c, 'embedding': embeddings[i], 'source_type': 'essay',
                     'source_title': proper_raw, 'source_id': None, 'source_date': None, 'chunk_index': i}
                    for i, c in enumerate(chunks)
                ]
                for start in range(0, len(rows), 100):
                    sb.table('sean_chunks').insert(rows[start:start+100]).execute()
            print(f"  ✓ fixed")
    else:
        print(f"  '{bad_title}' not found in corpus (already fixed or never existed)")

print()

# ── Insert into stories table ─────────────────────────────────────────────────
print("Inserting into stories table…")
inserted = skipped = errors = 0

for title, (raw, fp) in sorted(files.items()):
    if title in existing_stories:
        print(f"  SKIP  {title[:75]}")
        skipped += 1
        continue

    text    = fp.read_text(encoding='utf-8', errors='replace').strip()
    excerpt = get_excerpt(text)

    print(f"  →  {title[:70]}")
    if DRY_RUN:
        inserted += 1
        continue

    try:
        sb.table('stories').insert({
            'title':        title,
            'excerpt':      excerpt,
            'body':         text,
            'content_type': 'essay',
            'sort_order':   0,
        }).execute()
        inserted += 1
        print(f"     ✓ inserted")
    except Exception as e:
        print(f"     ✗ ERROR: {e}")
        errors += 1

print()
print('=' * 60)
action = 'previewed' if DRY_RUN else 'inserted'
print(f"DONE  —  {action}: {inserted}  skipped: {skipped}  errors: {errors}")
print('=' * 60)
