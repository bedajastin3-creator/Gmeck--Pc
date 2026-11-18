// functions/api/stores.ts
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Device-ID',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(data: any, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  });
}

function normalizeStoreRow(row: any) {
  if (!row) return row;
  return {
    id: row.id,
    shopId: row.shop_id ?? row.shopId,
    shop_id: row.shop_id ?? row.shopId,
    name: row.name,
    location: row.location ?? null,
    status: row.status || 'ACTIVE',
    isShopFloor: row.is_shop_floor !== undefined ? Boolean(row.is_shop_floor) : Boolean(row.isShopFloor),
    is_shop_floor: row.is_shop_floor !== undefined ? row.is_shop_floor : (row.isShopFloor ? 1 : 0),
    createdAt: row.created_at ?? row.createdAt,
    created_at: row.created_at ?? row.createdAt,
    updatedAt: row.updated_at ?? row.updatedAt,
    updated_at: row.updated_at ?? row.updatedAt,
  };
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS_HEADERS });
}

export async function onRequestGet(context: any) {
  const { request, env } = context;

  try {
    const url = new URL(request.url);
    const shopId = url.searchParams.get('shopId') || url.searchParams.get('shop_id');
    const status = url.searchParams.get('status');

    let query = 'SELECT * FROM stores WHERE 1=1';
    const params: any[] = [];

    if (shopId && shopId !== 'ALL') {
      query += ' AND shop_id = ?';
      params.push(shopId);
    }

    if (status && status !== 'ALL') {
      query += ' AND UPPER(status) = UPPER(?)';
      params.push(status);
    }

    let results: any[] = [];
    try {
      const res = await env.DB.prepare(`${query} ORDER BY created_at DESC`).bind(...params).all();
      results = res.results || [];
    } catch {
      // Fallback in case created_at column differs in schema
      const res = await env.DB.prepare(query).bind(...params).all();
      results = res.results || [];
    }

    return jsonResponse(results.map(normalizeStoreRow));
  } catch (error: any) {
    console.error('[GET /api/stores] Error:', error?.message || error);
    return jsonResponse({ error: error?.message || 'Failed to fetch stores' }, 500);
  }
}

export async function onRequestPost(context: any) {
  const { request, env } = context;

  try {
    const store = await request.json();
    const id = store.id || crypto.randomUUID();
    const shopId = store.shopId || store.shop_id;
    const name = typeof store.name === 'string' ? store.name.trim() : '';

    if (!shopId) {
      return jsonResponse({ error: 'shopId is required' }, 400);
    }
    if (!name) {
      return jsonResponse({ error: 'Store name is required' }, 400);
    }

    const shop = await env.DB.prepare('SELECT id FROM shops WHERE id = ?').bind(shopId).first();
    if (!shop) {
      return jsonResponse({ error: `Shop "${shopId}" does not exist` }, 404);
    }

    const now = new Date().toISOString();
    const createdAt = store.createdAt || store.created_at || now;
    const updatedAt = store.updatedAt || store.updated_at || now;

    await env.DB.prepare(`
      INSERT INTO stores (id, shop_id, name, location, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        shop_id = excluded.shop_id,
        name = excluded.name,
        location = excluded.location,
        status = excluded.status,
        updated_at = excluded.updated_at
    `)
      .bind(
        id,
        shopId,
        name,
        store.location || null,
        store.status || 'ACTIVE',
        createdAt,
        updatedAt
      )
      .run();

    const saved = await env.DB.prepare('SELECT * FROM stores WHERE id = ?').bind(id).first();
    return jsonResponse({ success: true, id, store: normalizeStoreRow(saved) });
  } catch (error: any) {
    console.error('[POST /api/stores] Error:', error?.message || error);
    return jsonResponse({ error: error?.message || 'Failed to save store' }, 500);
  }
}

export async function onRequestPut(context: any) {
  const { request, env } = context;

  try {
    const url = new URL(request.url);
    const body = await request.json();
    const id = body.id || url.searchParams.get('id');

    if (!id) {
      return jsonResponse({ error: 'Store id is required' }, 400);
    }

    const existing = await env.DB.prepare('SELECT * FROM stores WHERE id = ?').bind(id).first();
    if (!existing) {
      return jsonResponse({ error: 'Store not found' }, 404);
    }

    const shopId = body.shopId || body.shop_id || existing.shop_id;
    const name = body.name !== undefined ? String(body.name).trim() : existing.name;
    if (!name) {
      return jsonResponse({ error: 'Store name cannot be empty' }, 400);
    }

    const location = body.location !== undefined ? body.location || null : existing.location;
    const status = body.status || existing.status || 'ACTIVE';
    const now = new Date().toISOString();

    await env.DB.prepare(`
      UPDATE stores
      SET shop_id = ?, name = ?, location = ?, status = ?, updated_at = ?
      WHERE id = ?
    `)
      .bind(shopId, name, location, status, now, id)
      .run();

    const saved = await env.DB.prepare('SELECT * FROM stores WHERE id = ?').bind(id).first();
    return jsonResponse({ success: true, id, store: normalizeStoreRow(saved) });
  } catch (error: any) {
    console.error('[PUT /api/stores] Error:', error?.message || error);
    return jsonResponse({ error: error?.message || 'Failed to update store' }, 500);
  }
}

export async function onRequestDelete(context: any) {
  const { request, env } = context;

  try {
    const url = new URL(request.url);
    let id = url.searchParams.get('id');

    if (!id) {
      try {
        const body = await request.json();
        id = body?.id;
      } catch {
        // Ignore empty body
      }
    }

    if (!id) {
      return jsonResponse({ error: 'Store id is required' }, 400);
    }

    await env.DB.prepare('UPDATE inventory_movements SET store_id = NULL WHERE store_id = ?')
      .bind(id)
      .run();
    await env.DB.prepare('DELETE FROM stores WHERE id = ?').bind(id).run();

    return jsonResponse({ success: true, id });
  } catch (error: any) {
    console.error('[DELETE /api/stores] Error:', error?.message || error);
    return jsonResponse({ error: error?.message || 'Failed to delete store' }, 500);
  }
}
