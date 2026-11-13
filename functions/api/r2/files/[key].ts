export async function onRequestGet(context: any) {
  const { env } = context;
  const key = context.params.key;
  
  try {
    // Try to get the file - try both paths
    let object = await env.MEDIA_BUCKET.get(key);
    
    // If not found, try with 'files/' prefix
    if (!object) {
      object = await env.MEDIA_BUCKET.get(`files/${key}`);
    }
    
    if (!object) {
      return new Response(JSON.stringify({ error: 'File not found' }), { 
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    headers.set('Content-Disposition', 'inline');

    return new Response(object.body, { headers });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
