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
    const { username, password } = await request.json();
    
    if (!username || !password) {
      return new Response(JSON.stringify({ error: 'Username and password required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const user = await env.DB.prepare(
      'SELECT * FROM users WHERE LOWER(username) = LOWER(?) AND status = ?'
    ).bind(username, 'ACTIVE').first();

    if (!user) {
      return new Response(JSON.stringify({ error: 'Invalid credentials' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    let parsedShopIds: string[] = [];
    try {
      parsedShopIds = typeof user.assigned_shop_ids === 'string'
        ? JSON.parse(user.assigned_shop_ids || '[]')
        : (user.assigned_shop_ids || []);
    } catch {
      parsedShopIds = [];
    }

    let parsedPermissions: Record<string, any> = {};
    try {
      let rawPerms = user.permissions;
      while (typeof rawPerms === 'string' && rawPerms.trim()) {
        rawPerms = JSON.parse(rawPerms);
      }
      if (rawPerms && typeof rawPerms === 'object' && !Array.isArray(rawPerms)) {
        parsedPermissions = rawPerms;
      }
    } catch {
      parsedPermissions = {};
    }

    return new Response(JSON.stringify({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        color: user.color,
        status: user.status,
        assignedShopIds: parsedShopIds,
        avatarUrl: user.avatar_url || null,
        permissions: parsedPermissions,
        created_at: user.created_at,
        updated_at: user.updated_at,
      },
      token: `token_${user.id}_${Date.now()}`,
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
