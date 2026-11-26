// functions/api/customer-records.ts

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Device-ID',
  'Access-Control-Max-Age': '86400',
};

const MAX_PHOTOS_PER_PRODUCT = 3;
const MAX_TOTAL_IMAGE_URLS = 24;

function jsonResponse(data: any, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  });
}

function isValidImageUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2048) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function parseImageUrls(raw: unknown, maxCount: number = MAX_TOTAL_IMAGE_URLS): string[] {
  if (Array.isArray(raw)) {
    return raw.filter(isValidImageUrl).slice(0, maxCount);
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter(isValidImageUrl).slice(0, maxCount);
      }
    } catch {
      return [];
    }
  }
  return [];
}

function sanitizeRecordItems(raw: unknown): any[] {
  let list: any[] = [];
  if (Array.isArray(raw)) {
    list = raw;
  } else if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      list = [];
    }
  }

  return list
    .filter(item => item && typeof item === 'object')
    .slice(0, 100)
    .map(item => ({
      productId: String(item.productId || '').trim().slice(0, 120),
      productName: String(item.productName || 'Unnamed Product').trim().slice(0, 200),
      variation: item.variation ? String(item.variation).trim().slice(0, 120) : undefined,
      sku: item.sku ? String(item.sku).trim().slice(0, 80) : undefined,
      unit: item.unit ? String(item.unit).trim().slice(0, 40) : undefined,
      quantity: Math.max(0, Number(item.quantity) || 0),
      purchasePrice: Math.max(0, Number(item.purchasePrice) || 0),
      unitPrice: Math.max(0, Number(item.unitPrice) || 0),
      total: Math.max(0, Number(item.total) || 0),
      imageUrls: parseImageUrls(item.imageUrls, MAX_PHOTOS_PER_PRODUCT),
    }));
}

function formatRecordRow(row: any) {
  return {
    id: row.id,
    customerName: row.customer_name,
    phoneNumber: row.phone_number,
    imageUrls: parseImageUrls(row.image_urls),
    saleId: row.sale_id || undefined,
    receiptNumber: row.receipt_number || undefined,
    shopId: row.shop_id || undefined,
    shopName: row.shop_name || undefined,
    saleDate: row.sale_date || row.created_at || undefined,
    items: sanitizeRecordItems(row.items_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

let extendedColsChecked = false;
let hasExtendedCols = false;

async function ensureCustomerRecordsSchema(db: any): Promise<boolean> {
  await db
    .prepare(
      `
      CREATE TABLE IF NOT EXISTS customer_records (
        id TEXT PRIMARY KEY,
        customer_name TEXT NOT NULL,
        phone_number TEXT NOT NULL,
        image_urls TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `
    )
    .run();

  if (extendedColsChecked) return hasExtendedCols;
  extendedColsChecked = true;
  try {
    const info = await db.prepare('PRAGMA table_info(customer_records)').all();
    const cols = new Set(
      (info?.results || []).map((c: any) => String(c.name || '').toLowerCase())
    );
    const migrations: [string, string][] = [
      ['sale_id', 'ALTER TABLE customer_records ADD COLUMN sale_id TEXT'],
      ['receipt_number', 'ALTER TABLE customer_records ADD COLUMN receipt_number TEXT'],
      ['shop_id', 'ALTER TABLE customer_records ADD COLUMN shop_id TEXT'],
      ['shop_name', 'ALTER TABLE customer_records ADD COLUMN shop_name TEXT'],
      ['sale_date', 'ALTER TABLE customer_records ADD COLUMN sale_date TEXT'],
      ['items_json', "ALTER TABLE customer_records ADD COLUMN items_json TEXT NOT NULL DEFAULT '[]'"],
    ];
    for (const [col, ddl] of migrations) {
      if (!cols.has(col)) {
        await db.prepare(ddl).run();
      }
    }
    hasExtendedCols = true;
  } catch {
    hasExtendedCols = false;
  }
  return hasExtendedCols;
}

function validateRequestHeaders(request: Request): Response | null {
  const deviceId = (request.headers.get('X-Device-ID') || '').trim();
  if (!deviceId || deviceId.length < 4 || deviceId.length > 128) {
    return jsonResponse({ success: false, error: 'Missing or invalid device header' }, 401);
  }
  const authHeader = request.headers.get('Authorization');
  if (authHeader !== null) {
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!authHeader.startsWith('Bearer ') || token.length < 10) {
      return jsonResponse({ success: false, error: 'Invalid authorization token' }, 401);
    }
  }
  return null;
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS_HEADERS });
}

export async function onRequestGet(context: any) {
  const { request, env } = context;
  const authError = validateRequestHeaders(request);
  if (authError) return authError;

  try {
    await ensureCustomerRecordsSchema(env.DB);

    const url = new URL(request.url);
    const search = (url.searchParams.get('search') || '').trim();
    const rawLimit = Number(url.searchParams.get('limit') || 100);
    const limit = Number.isFinite(rawLimit)
      ? Math.max(1, Math.min(500, Math.floor(rawLimit)))
      : 100;

    let result;
    if (search) {
      const like = `%${search}%`;
      result = await env.DB.prepare(
        `
        SELECT *
        FROM customer_records
        WHERE customer_name LIKE ? OR phone_number LIKE ?
        ORDER BY created_at DESC
        LIMIT ?
      `
      )
        .bind(like, like, limit)
        .all();
    } else {
      result = await env.DB.prepare(
        `
        SELECT *
        FROM customer_records
        ORDER BY created_at DESC
        LIMIT ?
      `
      )
        .bind(limit)
        .all();
    }

    const records = (result?.results || []).map(formatRecordRow);
    return jsonResponse({ success: true, records });
  } catch (error: any) {
    return jsonResponse(
      { success: false, error: error?.message || 'Failed to fetch customer records' },
      500
    );
  }
}

export async function onRequestPost(context: any) {
  const { request, env } = context;
  const authError = validateRequestHeaders(request);
  if (authError) return authError;

  try {
    const extColsOk = await ensureCustomerRecordsSchema(env.DB);

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return jsonResponse({ success: false, error: 'Invalid JSON request body' }, 400);
    }

    const customerName = String(body.customerName ?? body.customer_name ?? '').trim();
    const phoneNumber = String(body.phoneNumber ?? body.phone_number ?? '').trim();
    const rawImages = body.imageUrls ?? body.image_urls ?? [];
    const items = sanitizeRecordItems(body.items ?? body.items_json ?? []);

    if (!customerName || customerName.length > 200) {
      return jsonResponse(
        { success: false, error: 'Jina la Mteja is required (max 200 characters)' },
        400
      );
    }

    if (!phoneNumber || phoneNumber.length > 40) {
      return jsonResponse(
        { success: false, error: 'Namba ya Simu is required (max 40 characters)' },
        400
      );
    }

    const itemUrls = items.flatMap(it => it.imageUrls || []);
    const imageUrls = Array.from(
      new Set([...parseImageUrls(rawImages), ...itemUrls])
    ).slice(0, MAX_TOTAL_IMAGE_URLS);

    if (imageUrls.length === 0) {
      return jsonResponse(
        { success: false, error: 'At least 1 valid product image URL is required' },
        400
      );
    }

    const rawId = typeof body.id === 'string' ? body.id.trim() : '';
    const id = rawId && rawId.length <= 120 ? rawId : crypto.randomUUID();
    const now = new Date().toISOString();
    const createdAt =
      typeof (body.createdAt ?? body.created_at) === 'string' &&
      String(body.createdAt ?? body.created_at).trim()
        ? String(body.createdAt ?? body.created_at).trim()
        : now;

    const saleId = body.saleId || body.sale_id ? String(body.saleId ?? body.sale_id).trim().slice(0, 120) : null;
    const receiptNumber =
      body.receiptNumber || body.receipt_number
        ? String(body.receiptNumber ?? body.receipt_number).trim().slice(0, 80)
        : null;
    const shopId = body.shopId || body.shop_id ? String(body.shopId ?? body.shop_id).trim().slice(0, 120) : null;
    const shopName =
      body.shopName || body.shop_name
        ? String(body.shopName ?? body.shop_name).trim().slice(0, 160)
        : null;
    const saleDate =
      body.saleDate || body.sale_date
        ? String(body.saleDate ?? body.sale_date).trim().slice(0, 60)
        : createdAt;

    if (extColsOk) {
      await env.DB.prepare(
        `
        INSERT INTO customer_records (
          id, customer_name, phone_number, image_urls,
          sale_id, receipt_number, shop_id, shop_name, sale_date, items_json,
          created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          customer_name = excluded.customer_name,
          phone_number = excluded.phone_number,
          image_urls = excluded.image_urls,
          sale_id = excluded.sale_id,
          receipt_number = excluded.receipt_number,
          shop_id = excluded.shop_id,
          shop_name = excluded.shop_name,
          sale_date = excluded.sale_date,
          items_json = excluded.items_json,
          updated_at = excluded.updated_at
      `
      )
        .bind(
          id,
          customerName,
          phoneNumber,
          JSON.stringify(imageUrls),
          saleId,
          receiptNumber,
          shopId,
          shopName,
          saleDate,
          JSON.stringify(items),
          createdAt,
          now
        )
        .run();
    } else {
      await env.DB.prepare(
        `
        INSERT INTO customer_records (
          id, customer_name, phone_number, image_urls, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          customer_name = excluded.customer_name,
          phone_number = excluded.phone_number,
          image_urls = excluded.image_urls,
          updated_at = excluded.updated_at
      `
      )
        .bind(id, customerName, phoneNumber, JSON.stringify(imageUrls), createdAt, now)
        .run();
    }

    return jsonResponse(
      {
        success: true,
        record: {
          id,
          customerName,
          phoneNumber,
          imageUrls,
          saleId: saleId || undefined,
          receiptNumber: receiptNumber || undefined,
          shopId: shopId || undefined,
          shopName: shopName || undefined,
          saleDate,
          items,
          createdAt,
          updatedAt: now,
        },
      },
      201
    );
  } catch (error: any) {
    return jsonResponse(
      { success: false, error: error?.message || 'Failed to save customer record' },
      500
    );
  }
}
