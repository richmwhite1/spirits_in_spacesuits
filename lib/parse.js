// Shared text cleaning utilities — used by both scripts/ingest.js and api/admin/upload.js

export function stripSRT(text) {
  return text
    // Remove sequence numbers (lines with only digits)
    .replace(/^\d+\s*$/gm, '')
    // Remove timestamp lines: 00:00:01,234 --> 00:00:05,678
    .replace(/^\d{2}:\d{2}:\d{2}[,\.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,\.]\d{3}.*$/gm, '')
    // Remove VTT headers and blocks
    .replace(/^WEBVTT.*$/gm, '')
    .replace(/^NOTE\b.*$/gm, '')
    // Collapse leftover blank lines
    .replace(/\n{3,}/g, '\n\n');
}

export function cleanTranscript(text) {
  return stripSRT(text)
    .replace(/\[Music\]/gi, '')
    .replace(/\[Applause\]/gi, '')
    .replace(/\[Laughter\]/gi, '')
    .replace(/\[\w+\]/g, '')   // Remove any remaining [bracketed] artifacts
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function chunkText(text, chunkSize = 400, overlap = 80) {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks = [];
  for (let i = 0; i < words.length; i += chunkSize - overlap) {
    const chunk = words.slice(i, i + chunkSize).join(' ');
    if (chunk.trim().length > 80) chunks.push(chunk);
    if (i + chunkSize >= words.length) break;
  }
  return chunks;
}
