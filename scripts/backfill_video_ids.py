#!/usr/bin/env python3
"""
Backfill YouTube video IDs for existing sean_chunks transcript records.

Fetches all videos from the @spiritsinspacesuits YouTube channel,
fuzzy-matches against transcript titles in the database, and updates source_id.

Usage:
  python3 scripts/backfill_video_ids.py --dry-run   # preview matches
  python3 scripts/backfill_video_ids.py              # apply updates

Requires:
  YOUTUBE_API_KEY in .env.local (YouTube Data API v3 key)
  SUPABASE_URL + SUPABASE_SERVICE_KEY in .env.local
"""

import re, sys, json
from pathlib import Path
from difflib import SequenceMatcher
import urllib.request

# ── Config ──────────────────────────────────────────────────────────────────
REPO_ROOT      = Path(__file__).parent.parent
ENV_FILE       = REPO_ROOT / '.env.local'
CHANNEL_HANDLE = '@spiritsinspacesuits'
MATCH_THRESHOLD = 0.55  # minimum similarity ratio to consider a match

# ── Load env ────────────────────────────────────────────────────────────────
def load_env(path):
    env = {}
    for line in Path(path).read_text().splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, _, v = line.partition('=')
            env[k.strip()] = v.strip()
    return env

env = load_env(ENV_FILE)
YOUTUBE_API_KEY = env.get('YOUTUBE_API_KEY')
if not YOUTUBE_API_KEY:
    print("ERROR: YOUTUBE_API_KEY not found in .env.local")
    print("Get one at https://console.cloud.google.com/apis/credentials")
    print("Enable the YouTube Data API v3 for your project.")
    sys.exit(1)

from supabase import create_client
sb = create_client(env['SUPABASE_URL'], env['SUPABASE_SERVICE_KEY'])

# ── YouTube API helpers ─────────────────────────────────────────────────────
def yt_api(endpoint, params):
    """Make a YouTube Data API v3 request."""
    params['key'] = YOUTUBE_API_KEY
    qs = '&'.join(f'{k}={urllib.parse.quote(str(v))}' for k, v in params.items())
    url = f'https://www.googleapis.com/youtube/v3/{endpoint}?{qs}'
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

import urllib.parse

def get_channel_id():
    """Resolve channel handle to channel ID."""
    data = yt_api('channels', {'forHandle': CHANNEL_HANDLE, 'part': 'id'})
    if not data.get('items'):
        print(f"ERROR: Could not find channel {CHANNEL_HANDLE}")
        sys.exit(1)
    return data['items'][0]['id']

def get_uploads_playlist(channel_id):
    """Get the uploads playlist ID for a channel."""
    data = yt_api('channels', {'id': channel_id, 'part': 'contentDetails'})
    return data['items'][0]['contentDetails']['relatedPlaylists']['uploads']

def fetch_all_videos(playlist_id):
    """Fetch all videos from a playlist, handling pagination."""
    videos = []
    page_token = None
    while True:
        params = {
            'playlistId': playlist_id,
            'part': 'snippet',
            'maxResults': 50,
        }
        if page_token:
            params['pageToken'] = page_token
        data = yt_api('playlistItems', params)
        for item in data.get('items', []):
            snippet = item['snippet']
            videos.append({
                'id': snippet['resourceId']['videoId'],
                'title': snippet['title'],
                'date': snippet.get('publishedAt', '')[:10],
            })
        page_token = data.get('nextPageToken')
        if not page_token:
            break
    return videos

# ── Title normalisation for better matching ─────────────────────────────────
def normalise(title):
    """Normalise a title for fuzzy matching."""
    t = title.lower().strip()
    # Remove common prefixes/suffixes
    t = re.sub(r'^\(final\s+draft\)\s*', '', t)
    # Remove dates at start or end
    t = re.sub(r'\d{4}-\d{2}-\d{2}', '', t)
    t = re.sub(r'\d{4}', '', t)
    # Remove punctuation and extra whitespace
    t = re.sub(r'[^\w\s]', ' ', t)
    t = re.sub(r'\s+', ' ', t).strip()
    return t

def similarity(a, b):
    """Compute similarity between two normalised titles."""
    return SequenceMatcher(None, normalise(a), normalise(b)).ratio()

# ── Main ────────────────────────────────────────────────────────────────────
def main():
    dry_run = '--dry-run' in sys.argv

    if dry_run:
        print("=== DRY RUN — no database changes will be made ===\n")

    # 1. Fetch YouTube channel videos
    print("Resolving channel ID…")
    channel_id = get_channel_id()
    print(f"  Channel ID: {channel_id}")

    uploads_id = get_uploads_playlist(channel_id)
    print(f"  Uploads playlist: {uploads_id}")

    print("Fetching all videos…")
    videos = fetch_all_videos(uploads_id)
    print(f"  Found {len(videos)} videos on channel.\n")

    # 2. Fetch all transcript titles with no video ID (paginated — Supabase has 1000-row default limit)
    print("Fetching transcript titles without video IDs…")
    all_titles = set()
    page_size = 1000
    offset = 0
    while True:
        result = sb.table('sean_chunks') \
            .select('source_title') \
            .eq('source_type', 'transcript') \
            .is_('source_id', 'null') \
            .range(offset, offset + page_size - 1) \
            .execute()
        for r in result.data:
            all_titles.add(r['source_title'])
        if len(result.data) < page_size:
            break
        offset += page_size

    titles = sorted(all_titles)
    print(f"  Found {len(titles)} transcript titles without video IDs.\n")

    if not titles:
        print("Nothing to backfill!")
        return

    # 3. Fuzzy match
    matched = []
    unmatched = []

    for title in titles:
        best_score = 0
        best_video = None
        for video in videos:
            score = similarity(title, video['title'])
            if score > best_score:
                best_score = score
                best_video = video
        if best_score >= MATCH_THRESHOLD and best_video:
            matched.append((title, best_video, best_score))
        else:
            unmatched.append((title, best_video, best_score))

    # Print results
    print(f"{'='*70}")
    print(f"  MATCHED: {len(matched)}  |  UNMATCHED: {len(unmatched)}")
    print(f"{'='*70}\n")

    if matched:
        print("MATCHED (will update):")
        for title, video, score in sorted(matched, key=lambda x: -x[2]):
            print(f"  [{score:.0%}] DB: {title[:55]}")
            print(f"         YT: {video['title'][:55]}  ({video['id']})")
            print()

    if unmatched:
        print("UNMATCHED (no update):")
        for title, video, score in unmatched:
            best_info = f"  best: [{score:.0%}] {video['title'][:45]}" if video else ""
            print(f"  ✗ {title[:60]}{best_info}")
        print()

    # 4. Apply updates
    if dry_run:
        print(f"\nDry run complete. {len(matched)} titles would be updated.")
        print("Run without --dry-run to apply changes.")
        return

    if not matched:
        print("No matches to apply.")
        return

    print(f"Applying {len(matched)} updates…")
    updated = 0
    for title, video, score in matched:
        res = sb.table('sean_chunks') \
            .update({'source_id': video['id']}) \
            .eq('source_title', title) \
            .eq('source_type', 'transcript') \
            .execute()
        count = len(res.data) if res.data else 0
        print(f"  ✓ {title[:55]} → {video['id']} ({count} chunks)")
        updated += count

    print(f"\nDone! Updated {updated} chunks across {len(matched)} titles.")

if __name__ == '__main__':
    main()
