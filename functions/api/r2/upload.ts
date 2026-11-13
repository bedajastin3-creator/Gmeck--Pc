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
    const type = formData.get('type') as string;
    const entityId = formData.get('entityId') as string;
    const imageOrder = formData.get('imageOrder') as string;

    if (!file || !entityId) {
      return new Response(JSON.stringify({ error: 'Missing file or entityId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const key = type === 'seller' 
      ? `sellers/${entityId}/profile_${Date.now()}_${file.name}`
      : `products/${entityId}/${Date.now()}_${file.name}`;

    await env.MEDIA_BUCKET.put(key, file.stream(), {
      httpMetadata: { contentType: file.type },
    });

    // Use custom R2 domain
    const fullUrl = `https://m.gmeck.sonkosound.store//${key}`;

    // Update database for seller avatars
    if (type === 'seller') {
      await env.DB.prepare(`
        ALTER TABLE users ADD COLUMN avatar_url TEXT
      `).run().catch(() => {});
      
      await env.DB.prepare(`
        UPDATE users SET avatar_url = ?, updated_at = ? WHERE id = ?
      `).bind(fullUrl, new Date().toISOString(), entityId).run();
    }

    return new Response(JSON.stringify({
      success: true,
      key,
      size: file.size,
      mimeType: file.type,
      url: fullUrl,
    }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
