const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
]);

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

function sanitizeSegment(input: string, fallback: string): string {
  const cleaned = String(input || '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/\.{2,}/g, '_')
    .replace(/^[_.-]+|[_.-]+$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Device-ID',
      'Access-Control-Max-Age': '86400',
    },
  });
}

export async function onRequestPost(context: any) {
  const { request, env } = context;

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const type = String(formData.get('type') || 'product').trim();
    const entityId = String(formData.get('entityId') || '').trim();
    const imageOrder = String(formData.get('imageOrder') || '0').trim();

    if (!file || !entityId) {
      return new Response(JSON.stringify({ error: 'Missing file or entityId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const mimeType = String(file.type || 'image/jpeg').toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
      return new Response(JSON.stringify({ error: 'Unsupported image format' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    if (typeof file.size === 'number' && file.size > MAX_UPLOAD_BYTES) {
      return new Response(JSON.stringify({ error: 'Image file exceeds 10MB limit' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const safeEntityId = sanitizeSegment(entityId, 'item');
    const safeOrder = sanitizeSegment(imageOrder, '0');
    const safeFileName = sanitizeSegment(file.name || 'photo.jpg', 'photo.jpg');

    const key =
      type === 'seller'
        ? `sellers/${safeEntityId}/profile_${Date.now()}_${safeFileName}`
        : type === 'customer_record'
          ? `customer-records/${safeEntityId}/${Date.now()}_${safeOrder}_${safeFileName}`
          : `products/${safeEntityId}/${Date.now()}_${safeFileName}`;

    await env.MEDIA_BUCKET.put(key, file.stream(), {
      httpMetadata: { contentType: mimeType },
    });

    // Use custom R2 domain
    const fullUrl = `https://m.gmeck.sonkosound.store/${key}`;

    // Update database for seller avatars
    if (type === 'seller') {
      await env.DB.prepare(`
        ALTER TABLE users ADD COLUMN avatar_url TEXT
      `).run().catch(() => {});

      await env.DB.prepare(`
        UPDATE users SET avatar_url = ?, updated_at = ? WHERE id = ?
      `).bind(fullUrl, new Date().toISOString(), entityId).run();
    }

    return new Response(
      JSON.stringify({
        success: true,
        key,
        size: file.size,
        mimeType,
        url: fullUrl,
      }),
      {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      }
    );
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
