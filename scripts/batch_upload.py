#!/usr/bin/env python3
"""
Batch upload stories, essays, and poems from zip-extracted directories.
Reads .env.local for Supabase credentials and uploads directly.

Usage: python3 scripts/batch_upload.py
"""

import os, re, subprocess, sys
from pathlib import Path
from supabase import create_client

# ── Config ─────────────────────────────────────────────────────────────────
REPO_ROOT = Path(__file__).parent.parent
ENV_FILE  = REPO_ROOT / '.env.local'
STORIES_DIR = Path('/tmp/spirits-content/stories/Stories')
ESSAYS_DIR  = Path('/tmp/spirits-content/essays/Essays')
POEMS_DIR   = Path('/tmp/spirits-content/poems/Poems')

# ── Load env vars ──────────────────────────────────────────────────────────
def load_env(path):
    env = {}
    for line in Path(path).read_text().splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, _, v = line.partition('=')
            env[k.strip()] = v.strip()
    return env

env = load_env(ENV_FILE)
sb = create_client(env['SUPABASE_URL'], env['SUPABASE_SERVICE_KEY'])

def supabase_select(table, select='*'):
    result = sb.table(table).select(select).execute()
    return result.data

def supabase_insert(table, rows):
    import time
    for attempt in range(3):
        try:
            result = sb.table(table).insert(rows).execute()
            return result.data
        except Exception as e:
            if attempt < 2:
                print(f"  Retry {attempt+1}…")
                time.sleep(2)
            else:
                raise

# ── Text extraction ────────────────────────────────────────────────────────
def extract_text(path: Path) -> str | None:
    """Extract plain text from a .doc file using macOS textutil."""
    try:
        result = subprocess.run(
            ['textutil', '-convert', 'txt', '-stdout', str(path)],
            capture_output=True, text=True, timeout=15
        )
        if result.returncode == 0:
            return result.stdout
        return None
    except Exception as e:
        print(f"  ERROR extracting {path.name}: {e}")
        return None

# ── Text → HTML ────────────────────────────────────────────────────────────
PAGE_RE = re.compile(r'\s*PAGE\s+\d+\s*', re.IGNORECASE)

def clean_text(text: str) -> str:
    """Remove null bytes and other problematic characters from extracted text."""
    # Remove null bytes (causes Supabase/Postgres 22P05 error)
    text = text.replace('\x00', '')
    # Remove other non-printable control chars except newline, tab, carriage return
    text = re.sub(r'[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]', '', text)
    return text

def text_to_html(text: str) -> str:
    """Convert plain text paragraphs to simple HTML."""
    # Clean null bytes and control characters
    text = clean_text(text)
    # Remove Word page markers
    text = PAGE_RE.sub('', text)
    # Split into paragraphs on blank lines
    paras = re.split(r'\n{2,}', text.strip())
    html_parts = []
    for para in paras:
        para = para.strip()
        if not para:
            continue
        # Preserve line breaks within a paragraph (poems, lists)
        lines = [l.rstrip() for l in para.splitlines()]
        inner = '<br>'.join(lines)
        html_parts.append(f'<p>{inner}</p>')
    return '\n'.join(html_parts)

# ── Date parsing ───────────────────────────────────────────────────────────
DATE_PATTERNS = [
    r'^\(?(\w+ \d+,?\s*\d{4})\)?$',
    r'^\(?(\w+ \d{4})\)?$',
    r'^\(?(\d{1,2}/\d{1,2}/\d{2,4})\)?$',
    r'^\(?((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})\)?$',
    r'^\(?((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+\d{1,2},?\s+\d{4})\)?$',
]

def parse_date(line: str) -> str | None:
    line = line.strip()
    for pat in DATE_PATTERNS:
        m = re.match(pat, line, re.IGNORECASE)
        if m:
            return m.group(1)
    return None

# ── Parse a document ────────────────────────────────────────────────────────
def parse_doc(path: Path, title_override: str | None = None) -> dict | None:
    text = extract_text(path)
    if not text:
        return None

    lines = text.splitlines()
    # Remove empty leading lines
    while lines and not lines[0].strip():
        lines.pop(0)

    if not lines:
        return None

    # Title: use filename (cleaned) as primary, fall back to first line
    if title_override:
        title = title_override
        # Body starts at line 0 unless line 0 matches the title
        body_start = 0
        if lines and lines[0].strip().lower() == title.lower():
            body_start = 1
    else:
        title = lines[0].strip()
        body_start = 1

    # Look for date in next few lines
    story_date = ''
    date_line_idx = None
    for i in range(body_start, min(body_start + 4, len(lines))):
        d = parse_date(lines[i])
        if d:
            story_date = d
            date_line_idx = i
            break

    # Build body: skip title and date lines
    skip = set([0] if not title_override else [])
    if date_line_idx is not None:
        skip.add(date_line_idx)

    body_lines = [l for i, l in enumerate(lines) if i not in skip]
    body_text = '\n'.join(body_lines).strip()
    body_html = text_to_html(body_text) if body_text else ''

    # Excerpt: first ~200 chars of body text (plain)
    plain_body = re.sub(r'<[^>]+>', '', body_html).strip()
    excerpt = (plain_body[:220].rsplit(' ', 1)[0] + '…') if len(plain_body) > 220 else plain_body

    return {
        'title': title,
        'story_date': story_date,
        'excerpt': excerpt,
        'body': body_html,
    }

# ── File collection ─────────────────────────────────────────────────────────
def collect_files(directory: Path) -> list[Path]:
    """Collect all .doc files from directory and one level of subdirs.
    Skip 'copy' duplicates, temp files, and __MACOSX."""
    files = []
    seen_stems = set()

    def should_skip(p: Path) -> bool:
        name = p.name
        if name.startswith('~$') or name.startswith('._') or name == '.DS_Store':
            return True
        if '__MACOSX' in str(p):
            return True
        # Skip non-document files
        if p.suffix.lower() in ['.ds_store', '.localized', '.png', '.jpg', '.jpeg', '.pdf']:
            return True
        # Skip "copy" duplicates — if stem ends with " copy" or " copy 2" etc.
        stem = p.stem
        if re.search(r'\s+copy(\s+\d+)?$', stem, re.IGNORECASE):
            return True
        return False

    def add_file(p: Path):
        if should_skip(p):
            return
        # Use stem for dedup (prefer .doc over no-extension)
        stem = p.stem if p.suffix else p.name
        stem_lower = stem.lower().strip()
        if stem_lower not in seen_stems:
            seen_stems.add(stem_lower)
            files.append(p)

    for item in sorted(directory.iterdir()):
        if item.name.startswith('__MACOSX') or item.name.startswith('.'):
            continue
        if item.is_dir():
            # Directory: collect .doc files inside (and extension-less Word docs)
            for sub in sorted(item.iterdir()):
                if sub.name.startswith('._') or sub.name.startswith('~$'):
                    continue
                if sub.is_file():
                    add_file(sub)
        elif item.is_file():
            add_file(item)

    return files

# ── Main ────────────────────────────────────────────────────────────────────
def main():
    # Fetch existing titles to avoid duplicates
    print("Fetching existing stories from database...")
    existing = supabase_select('stories', select='title')
    existing_titles = {r['title'].strip().lower() for r in existing}
    print(f"  Found {len(existing_titles)} existing records.")

    batches = [
        (STORIES_DIR, 'story'),
        (ESSAYS_DIR,  'essay'),
        (POEMS_DIR,   'poem'),
    ]

    total_inserted = 0
    total_skipped  = 0
    total_errors   = 0

    for directory, content_type in batches:
        print(f"\n{'='*60}")
        print(f"Processing {content_type.upper()}S from {directory.name}/")
        print('='*60)

        files = collect_files(directory)
        print(f"  {len(files)} files found (after dedup/skip)")

        batch_rows = []
        sort_base  = {'story': 100, 'essay': 1000, 'poem': 2000}[content_type]

        for i, fp in enumerate(files, 1):
            # Derive clean title from filename
            stem = fp.stem if fp.suffix else fp.name
            clean_title = stem.strip()

            if clean_title.lower() in existing_titles:
                print(f"  [{i:3d}] SKIP (exists): {clean_title[:60]}")
                total_skipped += 1
                continue

            result = parse_doc(fp, title_override=clean_title)
            if not result:
                print(f"  [{i:3d}] ERROR (no text): {fp.name[:60]}")
                total_errors += 1
                continue

            row = {
                'title':        result['title'],
                'excerpt':      result['excerpt'] or None,
                'body':         result['body'] or None,
                'story_date':   result['story_date'] or None,
                'content_type': content_type,
                'sort_order':   sort_base + i,
            }
            batch_rows.append(row)
            existing_titles.add(clean_title.lower())
            print(f"  [{i:3d}] QUEUED: {clean_title[:55]}" + (f" ({result['story_date']})" if result['story_date'] else ''))

        # Insert one by one to avoid network timeouts
        if batch_rows:
            import time
            for row in batch_rows:
                try:
                    supabase_insert('stories', [row])
                    total_inserted += 1
                    if total_inserted % 10 == 0:
                        print(f"  … {total_inserted} inserted so far")
                    time.sleep(0.1)  # small delay to avoid overwhelming connection
                except Exception as e:
                    print(f"\n  ✗ Error on '{row['title'][:40]}': {e}")
                    total_errors += 1

    print(f"\n{'='*60}")
    print(f"DONE — Inserted: {total_inserted} | Skipped: {total_skipped} | Errors: {total_errors}")
    print('='*60)

if __name__ == '__main__':
    main()
