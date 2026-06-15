// /api/videos — YouTube Data API proxy
// Returns latest videos, latest appearances (interviews), or search results
// Caches for 1 hour via Vercel edge cache — keeps API usage well under 10k/day
// AI sorting: Gemini 2.5 Flash Lite re-ranks by title/content richness

import { GoogleGenerativeAI } from '@google/generative-ai';
import { getSupabase } from '../lib/supabase.js';

const CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID || 'UCSEABr_YYaS6MLSAXE6Tuzw';
const YT_API_KEY = process.env.YOUTUBE_API_KEY;
const YT_BASE = 'https://www.googleapis.com/youtube/v3';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function aiSortVideos(videos) {
  if (videos.length <= 1) return videos;
  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash-lite',
      generationConfig: { maxOutputTokens: 300, temperature: 0 }
    });
    const list = videos.map((v, i) => `${i}. ${v.title} — ${(v.description || '').slice(0, 120)}`).join('\n');
    const result = await model.generateContent(
      `These are YouTube videos from a spiritual teacher. Analyse the title and any mentioned topics in the description. Sort by depth and richness of spiritual/philosophical content, most substantive first. Return ONLY a JSON array of the original indices, e.g. [3,0,2,1].\n${list}`
    );
    const text = result.response.text().trim();
    const match = text.match(/\[[\d,\s]+\]/);
    if (!match) return videos;
    const indices = JSON.parse(match[0]);
    if (indices.length !== videos.length || !indices.every(i => Number.isInteger(i) && i >= 0 && i < videos.length)) return videos;
    return indices.map(i => videos[i]);
  } catch {
    return videos; // Fall back to original order on error
  }
}

// Keywords that indicate a podcast/interview appearance (not a standalone homily)
const INTERVIEW_KEYWORDS = [
  'podcast', 'interview', 'with paul chek', 'aubrey marcus', 'gregg braden',
  'kyle kingsbury', 'batgap', 'regina meredith', 'amrit sandhu', 'samuel lee',
  'broader lens', 'weekend university', 'spirit gym', 'behind greatness',
  'next level soul', 'living 4d', 'flame interviews', 'awakening aphrodite',
  'om times', 'wellbeings'
];

function isInterview(title = '', description = '') {
  const combined = (title + ' ' + description).toLowerCase();
  return INTERVIEW_KEYWORDS.some(kw => combined.includes(kw));
}

export default async function handler(req) {
  if (!YT_API_KEY) {
    return new Response(JSON.stringify({ error: 'YouTube API key not configured' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }

  const url = new URL(req.url);
  const type = url.searchParams.get('type') || 'latest'; // latest | appearances | search | transcript-search | stats
  const query = url.searchParams.get('q') || '';
  const maxResults = Math.min(parseInt(url.searchParams.get('max') || '12'), 50);
  const pageToken = url.searchParams.get('pageToken') || '';

  try {
    // Return channel statistics (total video count)
    if (type === 'stats') {
      const statsRes = await fetch(
        `${YT_BASE}/channels?key=${YT_API_KEY}&id=${CHANNEL_ID}&part=statistics`
      );
      const statsData = await statsRes.json();
      if (statsData.error) throw new Error(statsData.error.message);
      const stats = statsData.items?.[0]?.statistics || {};
      return new Response(JSON.stringify({
        videoCount: parseInt(stats.videoCount || '0'),
        subscriberCount: parseInt(stats.subscriberCount || '0')
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200'
        }
      });
    }

    let videos = [];
    let nextPageToken = null;

    if (type === 'transcript-search' && query) {
      // Full-text search across ingested transcript chunks in Supabase
      const supabase = getSupabase();
      const { data: chunks, error } = await supabase
        .from('sean_chunks')
        .select('source_id, source_title, source_date')
        .eq('source_type', 'transcript')
        .ilike('content', `%${query}%`)
        .not('source_id', 'is', null)
        .limit(100);

      if (error) throw new Error(error.message);

      // Deduplicate by source_id
      const seen = new Set();
      const unique = [];
      for (const chunk of (chunks || [])) {
        if (chunk.source_id && !seen.has(chunk.source_id)) {
          seen.add(chunk.source_id);
          unique.push(chunk);
        }
      }

      if (unique.length > 0) {
        // Batch-fetch YouTube metadata for matched video IDs (max 50 per request)
        const ids = unique.slice(0, 50).map(c => c.source_id).join(',');
        const ytRes = await fetch(`${YT_BASE}/videos?key=${YT_API_KEY}&id=${ids}&part=snippet`);
        const ytData = await ytRes.json();
        if (ytData.error) throw new Error(ytData.error.message);
        videos = (ytData.items || []).map(item => ({
          id: item.id,
          title: item.snippet.title,
          description: item.snippet.description?.slice(0, 200),
          thumbnail: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.medium?.url || `https://img.youtube.com/vi/${item.id}/hqdefault.jpg`,
          publishedAt: item.snippet.publishedAt,
          channelTitle: item.snippet.channelTitle,
          transcriptMatch: true
        }));
      }

      return new Response(JSON.stringify({ videos, nextPageToken: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });

    } else if (type === 'search' && query) {
      // Keyword search within the channel (title/description via YouTube API)
      const params = new URLSearchParams({
        key: YT_API_KEY,
        channelId: CHANNEL_ID,
        q: query,
        type: 'video',
        part: 'snippet',
        maxResults,
        order: 'relevance',
        ...(pageToken && { pageToken })
      });

      const res = await fetch(`${YT_BASE}/search?${params}`);
      const data = await res.json();

      if (data.error) throw new Error(data.error.message);

      nextPageToken = data.nextPageToken || null;
      videos = (data.items || []).map(formatSearchItem);

    } else {
      // Get channel uploads playlist ID first (cached via edge)
      const channelRes = await fetch(
        `${YT_BASE}/channels?key=${YT_API_KEY}&id=${CHANNEL_ID}&part=contentDetails`
      );
      const channelData = await channelRes.json();
      if (channelData.error) throw new Error(`Channel API error: ${channelData.error.message}`);
      const uploadsPlaylistId = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;

      if (!uploadsPlaylistId) throw new Error('Could not find uploads playlist');

      // Fetch latest uploads
      const params = new URLSearchParams({
        key: YT_API_KEY,
        playlistId: uploadsPlaylistId,
        part: 'snippet',
        maxResults: type === 'appearances' ? 50 : maxResults, // Fetch more to filter interviews
        ...(pageToken && { pageToken })
      });

      const res = await fetch(`${YT_BASE}/playlistItems?${params}`);
      const data = await res.json();

      if (data.error) throw new Error(data.error.message);

      nextPageToken = data.nextPageToken || null;
      const allVideos = (data.items || []).map(formatPlaylistItem);

      if (type === 'appearances') {
        // Filter to just interviews/podcasts, then AI-sort by content richness
        const filtered = allVideos
          .filter(v => isInterview(v.title, v.description))
          .slice(0, 12);
        videos = await aiSortVideos(filtered.slice(0, 6));
      } else {
        // Chronological order (newest first) — keeps CPU usage low on the homepage feed
        videos = allVideos;
      }
    }

    return new Response(JSON.stringify({ videos, nextPageToken }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        // Cache for 1 hour at the edge — reduces API quota usage dramatically
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200'
      }
    });

  } catch (err) {
    console.error('/api/videos error:', err.message);
    return new Response(JSON.stringify({ error: err.message, videos: [] }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

function formatPlaylistItem(item) {
  const s = item.snippet;
  const id = s.resourceId?.videoId;
  return {
    id,
    title: s.title,
    description: s.description?.slice(0, 200),
    thumbnail: s.thumbnails?.high?.url || s.thumbnails?.medium?.url || `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
    publishedAt: s.publishedAt,
    channelTitle: s.channelTitle
  };
}

function formatSearchItem(item) {
  const s = item.snippet;
  const id = item.id?.videoId;
  return {
    id,
    title: s.title,
    description: s.description?.slice(0, 200),
    thumbnail: s.thumbnails?.high?.url || s.thumbnails?.medium?.url || `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
    publishedAt: s.publishedAt,
    channelTitle: s.channelTitle
  };
}

export const config = { runtime: 'edge' };
