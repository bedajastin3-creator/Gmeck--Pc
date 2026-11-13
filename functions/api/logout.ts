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
    const { userId } = await request.json();
    
    await env.DB.prepare(`
      INSERT INTO audit_logs (id, user_id, user_name, action, details, entity_type, entity_id, timestamp)
      VALUES (?, ?, 'User', 'USER_LOGOUT', ?, 'AUTH', ?, ?)
    `).bind(
      crypto.randomUUID(),
      userId || 'unknown',
      'User logged out',
      userId || 'unknown',
      new Date().toISOString()
    ).run();

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
