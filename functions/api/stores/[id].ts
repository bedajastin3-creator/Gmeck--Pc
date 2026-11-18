// functions/api/stores/[id].ts
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
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
  const { env, params } = context;
  const id = params?.id;

  if (!id) {
    return jsonResponse({ error: 'Store id is required' }, 400);
  }

  try {
    const store = await env.DB.prepare('SELECT * FROM stores WHERE id = ?').bind(id).first();
    if (!store) {
      return jsonResponse({ error: 'Store not found' }, 404);
    }
    return jsonResponse(normalizeStoreRow(store));
  } catch (error: any) {
    console.error('[GET /api/stores/:id] Error:', error?.message || error);
    return jsonResponse({ error: error?.message || 'Failed to fetch store' }, 500);
  }
}

export async function onRequestPut(context: any) {
  const { request, env, params } = context;
  const id = params?.id;

  if (!id) {
    return jsonResponse({ error: 'Store id is required' }, 400);
  }

  try {
    const body = await request.json();
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
    console.error('[PUT /api/stores/:id] Error:', error?.message || error);
    return jsonResponse({ error: error?.message || 'Failed to update store' }, 500);
  }
}

export async function onRequestDelete(context: any) {
  const { env, params } = context;
  const id = params?.id;

  if (!id) {
    return jsonResponse({ error: 'Store id is required' }, 400);
  }

  try {
    await env.DB.prepare('UPDATE inventory_movements SET store_id = NULL WHERE store_id = ?')
      .bind(id)
      .run();
    await env.DB.prepare('DELETE FROM stores WHERE id = ?').bind(id).run();
    return jsonResponse({ success: true, id });
  } catch (error: any) {
    console.error('[DELETE /api/stores/:id] Error:', error?.message || error);
    return jsonResponse({ error: error?.message || 'Failed to delete store' }, 500);
  }
}
