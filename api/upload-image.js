// /api/upload-image — admin: upload a jpeg/png/gif/webp image to Supabase Storage
// POST (multipart form-data, field: "file") → returns { url }

const BUCKET = 'model-images';

function auth(req) {
  return req.headers.get('x-admin-secret') === process.env.ADMIN_SECRET;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200 });

  if (!auth(req)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' }
    });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

  try {
    const formData = await req.formData();
    const file = formData.get('file');

    if (!file || typeof file === 'string') {
      return new Response(JSON.stringify({ error: 'No file provided' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowed.includes(file.type)) {
      return new Response(JSON.stringify({ error: 'Only JPEG, PNG, GIF, and WebP images are allowed' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    // Ensure bucket exists (create if needed)
    await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'apikey': SUPABASE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true }),
    });
    // Ignore errors (bucket may already exist)

    // Generate unique filename
    const ext = file.type.split('/')[1].replace('jpeg', 'jpg');
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const arrayBuffer = await file.arrayBuffer();

    const uploadRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${filename}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'apikey': SUPABASE_KEY,
          'Content-Type': file.type,
          'x-upsert': 'true',
        },
        body: arrayBuffer,
      }
    );

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      return new Response(JSON.stringify({ error: `Upload failed: ${err}` }), {
        status: 500, headers: { 'Content-Type': 'application/json' }
      });
    }

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${filename}`;

    return new Response(JSON.stringify({ url: publicUrl }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}

export const config = { runtime: 'edge' };
