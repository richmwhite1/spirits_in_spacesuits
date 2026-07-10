#!/usr/bin/env python3
"""
Export the full corpus from Supabase to a single text file on the Desktop.
Pulls from:
  - sean_chunks  (transcripts, books, essays ingested via RAG pipeline)
  - stories      (essays, stories, poems stored directly)
"""

import re
import sys
from pathlib import Path
from collections import defaultdict
from supabase import create_client

# ── Config ────────────────────────────────────────────────────────────────────
ENV_FILE    = Path(__file__).parent.parent / '.env.local'
OUTPUT_FILE = Path.home() / 'Desktop' / 'spirits_corpus.txt'
PAGE_SIZE   = 1000   # Supabase max rows per request

# ── Load env ──────────────────────────────────────────────────────────────────
def load_env(path):
    env = {}
    for line in Path(path).read_text().splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, _, v = line.partition('=')
            env[k.strip()] = v.strip()
    return env

env = load_env(ENV_FILE)
sb  = create_client(env['SUPABASE_URL'], env['SUPABASE_SERVICE_KEY'])

# ── Fetch all rows with pagination ────────────────────────────────────────────
def fetch_all(table, select, order_by=None):
    rows = []
    offset = 0
    while True:
        q = sb.table(table).select(select).range(offset, offset + PAGE_SIZE - 1)
        if order_by:
            for col, asc in order_by:
                q = q.order(col, desc=not asc)
        result = q.execute()
        batch = result.data or []
        rows.extend(batch)
        print(f"  {table}: fetched {len(rows)} rows…", end='\r')
        if len(batch) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    print(f"  {table}: {len(rows)} rows total.     ")
    return rows

# ── Strip HTML tags ────────────────────────────────────────────────────────────
def strip_html(text):
    if not text:
        return ''
    text = re.sub(r'<[^>]+>', ' ', text)
    text = re.sub(r'&amp;', '&', text)
    text = re.sub(r'&lt;', '<', text)
    text = re.sub(r'&gt;', '>', text)
    text = re.sub(r'&nbsp;', ' ', text)
    text = re.sub(r'&#\d+;', '', text)
    text = re.sub(r'\s{2,}', ' ', text)
    return text.strip()

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    print("Fetching corpus from Supabase…\n")

    # 1. sean_chunks — the RAG knowledge base (transcripts, books, essays)
    chunks = fetch_all(
        'sean_chunks',
        'source_type, source_title, source_date, chunk_index, content',
        order_by=[('source_title', True), ('chunk_index', True)]
    )

    # Group chunks by (source_type, source_title)
    by_source = defaultdict(list)
    for c in chunks:
        key = (c.get('source_type', 'unknown'), c.get('source_title', 'Untitled'))
        by_source[key].append(c)

    # Sort chunks within each source by chunk_index
    for key in by_source:
        by_source[key].sort(key=lambda c: c.get('chunk_index', 0))

    # 2. stories table — essays, stories, poems with full HTML body
    stories = fetch_all(
        'stories',
        'title, content_type, story_date, excerpt, body',
        order_by=[('sort_order', True)]
    )

    # ── Write output ──────────────────────────────────────────────────────────
    print(f"\nWriting to {OUTPUT_FILE}…")

    type_order = ['transcript', 'book', 'essay', 'story', 'poem', 'unknown']

    # Group by source_type
    by_type = defaultdict(dict)
    for (stype, stitle), clist in by_source.items():
        by_type[stype][stitle] = clist

    lines = []
    lines.append('=' * 80)
    lines.append('SPIRITS IN SPACESUITS — COMPLETE CORPUS EXPORT')
    lines.append('=' * 80)
    lines.append('')

    # ── Chunks (RAG corpus) ───────────────────────────────────────────────────
    for stype in type_order + [t for t in by_type if t not in type_order]:
        if stype not in by_type:
            continue
        section_titles = sorted(by_type[stype].keys())
        type_label = stype.upper() + 'S'
        lines.append('')
        lines.append('=' * 80)
        lines.append(f'  {type_label}  ({len(section_titles)} items)')
        lines.append('=' * 80)

        for title in section_titles:
            clist = by_type[stype][title]
            date = clist[0].get('source_date', '') or ''
            lines.append('')
            lines.append('-' * 70)
            lines.append(f'TITLE: {title}')
            if date:
                lines.append(f'DATE:  {date}')
            lines.append('-' * 70)
            # Reconstruct full text from overlapping chunks using only non-overlapping portions
            # Simpler: just join unique sequential chunks (chunk 0, 1, 2…)
            full_text_parts = []
            for c in clist:
                full_text_parts.append(c.get('content', ''))
            # Naive join — chunks overlap but it's readable
            lines.append('\n'.join(full_text_parts))
            lines.append('')

    # ── Stories table ─────────────────────────────────────────────────────────
    for ctype in ['story', 'essay', 'poem']:
        subset = [s for s in stories if s.get('content_type') == ctype]
        if not subset:
            continue
        lines.append('')
        lines.append('=' * 80)
        lines.append(f'  {ctype.upper()}S FROM STORIES TABLE  ({len(subset)} items)')
        lines.append('=' * 80)
        for s in subset:
            lines.append('')
            lines.append('-' * 70)
            lines.append(f"TITLE: {s.get('title', 'Untitled')}")
            if s.get('story_date'):
                lines.append(f"DATE:  {s['story_date']}")
            lines.append('-' * 70)
            body = strip_html(s.get('body', '') or s.get('excerpt', ''))
            lines.append(body)
            lines.append('')

    output = '\n'.join(lines)
    OUTPUT_FILE.write_text(output, encoding='utf-8')

    size_mb = OUTPUT_FILE.stat().st_size / 1_048_576
    chunk_count = len(chunks)
    story_count = len(stories)
    source_count = len(by_source)

    print(f"\nDone.")
    print(f"  {chunk_count} chunks across {source_count} sources")
    print(f"  {story_count} stories/essays/poems from stories table")
    print(f"  File: {OUTPUT_FILE}  ({size_mb:.1f} MB)")

if __name__ == '__main__':
    main()
