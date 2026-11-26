// functions/api/customer-records/[id].ts

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Device-ID',
  'Access-Control-Max-Age': '86400',
};

const R2_PUBLIC_PREFIX = 'https://m.gmeck.sonkosound.store/';

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

function parseImageUrls(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter(isValidImageUrl).slice(0, 24);
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter(isValidImageUrl).slice(0, 24);
      }
    } catch {
      return [];
    }
  }
  return [];
}

function parseItemsJson(raw: unknown): any[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
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
    items: parseItemsJson(row.items_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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
  const { request, params, env } = context;
  const authError = validateRequestHeaders(request);
  if (authError) return authError;
  const id = String(params?.id || '').trim();
  if (!id) {
    return jsonResponse({ success: false, error: 'Missing customer record id' }, 400);
  }

  try {
    const row = await env.DB.prepare(
      'SELECT id, customer_name, phone_number, image_urls, created_at, updated_at FROM customer_records WHERE id = ?'
    )
      .bind(id)
      .first();

    if (!row) {
      return jsonResponse({ success: false, error: 'Customer record not found' }, 404);
    }

    return jsonResponse({ success: true, record: formatRecordRow(row) });
  } catch (error: any) {
    return jsonResponse(
      { success: false, error: error?.message || 'Failed to fetch customer record' },
      500
    );
  }
}

export async function onRequestPut(context: any) {
  const { params, request, env } = context;
  const authError = validateRequestHeaders(request);
  if (authError) return authError;
  const id = String(params?.id || '').trim();
  if (!id) {
    return jsonResponse({ success: false, error: 'Missing customer record id' }, 400);
  }

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return jsonResponse({ success: false, error: 'Invalid JSON request body' }, 400);
    }

    const existing = await env.DB.prepare('SELECT * FROM customer_records WHERE id = ?')
      .bind(id)
      .first();
    if (!existing) {
      return jsonResponse({ success: false, error: 'Customer record not found' }, 404);
    }

    const customerName = String(
      body.customerName ?? body.customer_name ?? existing.customer_name ?? ''
    ).trim();
    const phoneNumber = String(
      body.phoneNumber ?? body.phone_number ?? existing.phone_number ?? ''
    ).trim();
    const imageUrls =
      body.imageUrls !== undefined || body.image_urls !== undefined
        ? parseImageUrls(body.imageUrls ?? body.image_urls)
        : parseImageUrls(existing.image_urls);

    if (!customerName || customerName.length > 200) {
      return jsonResponse({ success: false, error: 'Invalid customer name' }, 400);
    }
    if (!phoneNumber || phoneNumber.length > 40) {
      return jsonResponse({ success: false, error: 'Invalid phone number' }, 400);
    }

    const now = new Date().toISOString();
    await env.DB.prepare(
      `
      UPDATE customer_records
      SET customer_name = ?, phone_number = ?, image_urls = ?, updated_at = ?
      WHERE id = ?
    `
    )
      .bind(customerName, phoneNumber, JSON.stringify(imageUrls), now, id)
      .run();

    return jsonResponse({
      success: true,
      record: {
        id,
        customerName,
        phoneNumber,
        imageUrls,
        createdAt: existing.created_at,
        updatedAt: now,
      },
    });
  } catch (error: any) {
    return jsonResponse(
      { success: false, error: error?.message || 'Failed to update customer record' },
      500
    );
  }
}

export async function onRequestDelete(context: any) {
  const { request, params, env } = context;
  const authError = validateRequestHeaders(request);
  if (authError) return authError;
  const id = String(params?.id || '').trim();
  if (!id) {
    return jsonResponse({ success: false, error: 'Missing customer record id' }, 400);
  }

  try {
    const existing = await env.DB.prepare(
      'SELECT id, image_urls FROM customer_records WHERE id = ?'
    )
      .bind(id)
      .first();

    if (!existing) {
      return jsonResponse({ success: false, error: 'Customer record not found' }, 404);
    }

    // Best-effort cleanup of R2 images owned under customer-records/
    const urls = parseImageUrls(existing.image_urls);
    if (env.MEDIA_BUCKET && urls.length > 0) {
      for (const imgUrl of urls) {
        if (imgUrl.startsWith(`${R2_PUBLIC_PREFIX}customer-records/`)) {
          const key = imgUrl.slice(R2_PUBLIC_PREFIX.length);
          if (key && !key.includes('..')) {
            await env.MEDIA_BUCKET.delete(key).catch(() => {});
          }
        }
      }
    }

    await env.DB.prepare('DELETE FROM customer_records WHERE id = ?').bind(id).run();
    return jsonResponse({ success: true, id });
  } catch (error: any) {
    return jsonResponse(
      { success: false, error: error?.message || 'Failed to delete customer record' },
      500
    );
  }
}
