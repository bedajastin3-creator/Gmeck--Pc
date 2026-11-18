// functions/api/shops.ts
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

async function deleteShopCascade(db: any, shopId: string) {
  await db
    .prepare(
      'DELETE FROM product_images WHERE product_id IN (SELECT id FROM products WHERE shop_id = ?)'
    )
    .bind(shopId)
    .run();
  await db.prepare('DELETE FROM inventory_movements WHERE shop_id = ?').bind(shopId).run();
  await db
    .prepare(
      'DELETE FROM purchase_items WHERE purchase_id IN (SELECT id FROM purchases WHERE shop_id = ?)'
    )
    .bind(shopId)
    .run();
  await db.prepare('DELETE FROM purchases WHERE shop_id = ?').bind(shopId).run();
  try {
    await db
      .prepare(
        'DELETE FROM sale_edit_requests WHERE sale_id IN (SELECT id FROM sales WHERE shop_id = ?)'
      )
      .bind(shopId)
      .run();
  } catch {
    // Ignore if sale_edit_requests table is absent
  }
  await db
    .prepare('DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE shop_id = ?)')
    .bind(shopId)
    .run();
  await db.prepare('DELETE FROM sales WHERE shop_id = ?').bind(shopId).run();
  await db.prepare('DELETE FROM products WHERE shop_id = ?').bind(shopId).run();
  await db.prepare('DELETE FROM categories WHERE shop_id = ?').bind(shopId).run();
  await db.prepare('DELETE FROM expenses WHERE shop_id = ?').bind(shopId).run();
  try {
    await db
      .prepare(
        'DELETE FROM debt_payments WHERE debt_id IN (SELECT id FROM debts WHERE shop_id = ?)'
      )
      .bind(shopId)
      .run();
  } catch {
    // Ignore if debt_payments table is absent
  }
  await db.prepare('DELETE FROM debts WHERE shop_id = ?').bind(shopId).run();
  await db.prepare('DELETE FROM stores WHERE shop_id = ?').bind(shopId).run();
  await db.prepare('DELETE FROM shops WHERE id = ?').bind(shopId).run();
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS_HEADERS });
}

export async function onRequestGet(context: any) {
  const { request, env } = context;

  try {
    const url = new URL(request.url);
    const status = url.searchParams.get('status');

    let query = 'SELECT * FROM shops WHERE 1=1';
    const params: any[] = [];

    if (status && status !== 'ALL') {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC';

    const { results } = await env.DB.prepare(query).bind(...params).all();
    return jsonResponse(results || []);
  } catch (error: any) {
    console.error('[GET /api/shops] Error:', error?.message || error);
    return jsonResponse({ error: error?.message || 'Failed to fetch shops' }, 500);
  }
}

export async function onRequestPost(context: any) {
  const { request, env } = context;

  try {
    const shop = await request.json();
    const id = shop.id || crypto.randomUUID();
    const now = new Date().toISOString();

    if (!shop.name || !String(shop.name).trim()) {
      return jsonResponse({ error: 'Shop name is required' }, 400);
    }

    await env.DB.prepare(`
      INSERT INTO shops (id, name, code, description, address, phone, status, color, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name, code = excluded.code, description = excluded.description,
        address = excluded.address, phone = excluded.phone, status = excluded.status,
        color = excluded.color, updated_at = excluded.updated_at
    `)
      .bind(
        id,
        String(shop.name).trim(),
        shop.code || null,
        shop.description || null,
        shop.address || null,
        shop.phone || null,
        shop.status || 'ACTIVE',
        shop.color || null,
        shop.createdAt || shop.created_at || now,
        shop.updatedAt || shop.updated_at || now
      )
      .run();

    const saved = await env.DB.prepare('SELECT * FROM shops WHERE id = ?').bind(id).first();
    return jsonResponse({ success: true, id, shop: saved });
  } catch (error: any) {
    console.error('[POST /api/shops] Error:', error?.message || error);
    return jsonResponse({ error: error?.message || 'Failed to save shop' }, 500);
  }
}

export async function onRequestPut(context: any) {
  const { request, env } = context;

  try {
    const url = new URL(request.url);
    const body = await request.json();
    const id = body.id || url.searchParams.get('id');

    if (!id) {
      return jsonResponse({ error: 'Shop id is required' }, 400);
    }

    const existing = await env.DB.prepare('SELECT * FROM shops WHERE id = ?').bind(id).first();
    if (!existing) {
      return jsonResponse({ error: 'Shop not found' }, 404);
    }

    const name = body.name !== undefined ? String(body.name).trim() : existing.name;
    if (!name) {
      return jsonResponse({ error: 'Shop name cannot be empty' }, 400);
    }

    const now = new Date().toISOString();
    await env.DB.prepare(`
      UPDATE shops
      SET name = ?, code = ?, description = ?, address = ?, phone = ?, status = ?, color = ?, updated_at = ?
      WHERE id = ?
    `)
      .bind(
        name,
        body.code !== undefined ? body.code || null : existing.code,
        body.description !== undefined ? body.description || null : existing.description,
        body.address !== undefined ? body.address || null : existing.address,
        body.phone !== undefined ? body.phone || null : existing.phone,
        body.status || existing.status || 'ACTIVE',
        body.color !== undefined ? body.color || null : existing.color,
        now,
        id
      )
      .run();

    const saved = await env.DB.prepare('SELECT * FROM shops WHERE id = ?').bind(id).first();
    return jsonResponse({ success: true, id, shop: saved });
  } catch (error: any) {
    console.error('[PUT /api/shops] Error:', error?.message || error);
    return jsonResponse({ error: error?.message || 'Failed to update shop' }, 500);
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
      return jsonResponse({ error: 'Shop id is required' }, 400);
    }

    await deleteShopCascade(env.DB, id);
    return jsonResponse({ success: true, id });
  } catch (error: any) {
    console.error('[DELETE /api/shops] Error:', error?.message || error);
    return jsonResponse({ error: error?.message || 'Failed to delete shop' }, 500);
  }
}
