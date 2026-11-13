// functions/_middleware.ts
export interface Env {
  DB: any;
  MEDIA_BUCKET: any;
  AUTH_SECRET: string;
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Device-ID',
  'Access-Control-Max-Age': '86400',
};

export function jsonResponse(data: any, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

export async function authenticate(request: Request, env: Env): Promise<Response | null> {
  const authHeader = request.headers.get('Authorization');
  
  if (!authHeader) {
    return jsonResponse({ error: 'Missing authorization header' }, 401);
  }

  const token = authHeader.replace('Bearer ', '');
  
  // Validate token (simple validation - enhance with JWT in production)
  if (!token || token.length < 10) {
    return jsonResponse({ error: 'Invalid token' }, 401);
  }

  // Device ID validation
  const deviceId = request.headers.get('X-Device-ID');
  if (!deviceId) {
    return jsonResponse({ error: 'Missing device ID' }, 401);
  }

  // Check if device is registered
  const device = await env.DB.prepare(
    'SELECT * FROM devices WHERE id = ?'
  ).bind(deviceId).first();

  if (!device) {
    // Auto-register new device
    await env.DB.prepare(`
      INSERT INTO devices (id, device_name, device_type, created_at, last_synced_at)
      VALUES (?, ?, 'WINDOWS_DESKTOP', ?, ?)
    `).bind(deviceId, 'Windows Desktop', new Date().toISOString(), new Date().toISOString()).run();
  } else {
    // Update last synced
    await env.DB.prepare(
      'UPDATE devices SET last_synced_at = ? WHERE id = ?'
    ).bind(new Date().toISOString(), deviceId).run();
  }

  return null; // Auth passed
}
