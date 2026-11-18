// functions/api/shops/[id].ts
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
  const { env, params } = context;
  const id = params?.id;

  if (!id) {
    return jsonResponse({ error: 'Shop id is required' }, 400);
  }

  try {
    const shop = await env.DB.prepare('SELECT * FROM shops WHERE id = ?').bind(id).first();
    if (!shop) {
      return jsonResponse({ error: 'Shop not found' }, 404);
    }
    return jsonResponse(shop);
  } catch (error: any) {
    console.error('[GET /api/shops/:id] Error:', error?.message || error);
    return jsonResponse({ error: error?.message || 'Failed to fetch shop' }, 500);
  }
}

export async function onRequestPut(context: any) {
  const { request, env, params } = context;
  const id = params?.id;

  if (!id) {
    return jsonResponse({ error: 'Shop id is required' }, 400);
  }

  try {
    const body = await request.json();
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
    console.error('[PUT /api/shops/:id] Error:', error?.message || error);
    return jsonResponse({ error: error?.message || 'Failed to update shop' }, 500);
  }
}

export async function onRequestDelete(context: any) {
  const { env, params } = context;
  const id = params?.id;

  if (!id) {
    return jsonResponse({ error: 'Shop id is required' }, 400);
  }

  try {
    await deleteShopCascade(env.DB, id);
    return jsonResponse({ success: true, id });
  } catch (error: any) {
    console.error('[DELETE /api/shops/:id] Error:', error?.message || error);
    return jsonResponse({ error: error?.message || 'Failed to delete shop' }, 500);
  }
}
