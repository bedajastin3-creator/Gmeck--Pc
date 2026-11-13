export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Device-ID',
      'Access-Control-Max-Age': '86400',
    },
  });
}

export async function onRequestGet(context: any) {
  const { request, env } = context;
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
  return new Response(JSON.stringify(results), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

export async function onRequestPost(context: any) {
  const { request, env } = context;
  const shop = await request.json();
  const id = shop.id || crypto.randomUUID();
  const now = new Date().toISOString();

  await env.DB.prepare(`
    INSERT INTO shops (id, name, code, description, address, phone, status, color, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name, code = excluded.code, description = excluded.description,
      address = excluded.address, phone = excluded.phone, status = excluded.status,
      color = excluded.color, updated_at = excluded.updated_at
  `).bind(
    id, shop.name, shop.code || null, shop.description || null,
    shop.address || null, shop.phone || null, shop.status || 'ACTIVE',
    shop.color || null, shop.createdAt || now, now
  ).run();

  return new Response(JSON.stringify({ success: true, id }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
