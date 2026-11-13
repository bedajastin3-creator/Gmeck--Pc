export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Device-ID',
      'Access-Control-Max-Age': '86400',
    },
  });
}

export async function onRequestGet(context: any) {
  const { request, env } = context;
  const url = new URL(request.url);
  const shopId = url.searchParams.get('shopId');

  let query = 'SELECT * FROM products WHERE 1=1';
  const params: any[] = [];

  if (shopId && shopId !== 'ALL') {
    query += ' AND shop_id = ?';
    params.push(shopId);
  }

  query += ' ORDER BY created_at DESC';

  const { results } = await env.DB.prepare(query).bind(...params).all();
  return new Response(JSON.stringify(results), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

export async function onRequestPost(context: any) {
  const { request, env } = context;
  const product = await request.json();
  const id = product.id || crypto.randomUUID();
  const now = new Date().toISOString();

  await env.DB.prepare(`
    INSERT INTO products (
      id, shop_id, name, sku, barcode, category_id,
      selling_price, proposed_selling_price, purchase_price,
      current_stock, min_stock, unit, status, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      shop_id = excluded.shop_id, name = excluded.name, sku = excluded.sku,
      barcode = excluded.barcode, category_id = excluded.category_id,
      selling_price = excluded.selling_price, purchase_price = excluded.purchase_price,
      current_stock = excluded.current_stock, min_stock = excluded.min_stock,
      unit = excluded.unit, status = excluded.status, updated_at = excluded.updated_at
  `).bind(
    id, product.shopId, product.name, product.sku, product.barcode || null,
    product.categoryId, product.sellingPrice || 0, product.proposedSellingPrice || null,
    product.purchasePrice || 0, product.currentStock || 0, product.minStock || 5,
    product.unit || 'pcs', product.status || 'ACTIVE',
    product.createdAt || now, now
  ).run();

  return new Response(JSON.stringify({ success: true, id }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
