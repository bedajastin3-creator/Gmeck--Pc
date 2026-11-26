// functions/api/settings.ts

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
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

async function ensureSettingsFeatureColumns(db: any): Promise<{
  hasAssistant: boolean;
  hasCustomerDetails: boolean;
}> {
  let hasAssistant = false;
  let hasCustomerDetails = false;
  try {
    const info = await db.prepare('PRAGMA table_info(settings)').all();
    const cols = new Set(
      (info?.results || []).map((c: any) => String(c.name || '').toLowerCase())
    );
    if (!cols.has('enable_sales_assistant')) {
      await db
        .prepare('ALTER TABLE settings ADD COLUMN enable_sales_assistant INTEGER NOT NULL DEFAULT 0')
        .run();
    }
    hasAssistant = true;

    if (!cols.has('enable_customer_details')) {
      await db
        .prepare('ALTER TABLE settings ADD COLUMN enable_customer_details INTEGER NOT NULL DEFAULT 0')
        .run();
    }
    hasCustomerDetails = true;
  } catch {
    // Fallback gracefully if ALTER TABLE is unavailable
  }
  return { hasAssistant, hasCustomerDetails };
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
    await ensureSettingsFeatureColumns(env.DB);
    const row = await env.DB.prepare("SELECT * FROM settings WHERE id = 'global'").first();
    return jsonResponse({ success: true, settings: row || null });
  } catch (error: any) {
    return jsonResponse(
      { success: false, error: error?.message || 'Failed to load settings' },
      500
    );
  }
}

export async function onRequestPut(context: any) {
  const { request, env } = context;
  const authError = validateRequestHeaders(request);
  if (authError) return authError;

  try {
    const settings = await request.json().catch(() => null);
    if (!settings || typeof settings !== 'object') {
      return jsonResponse({ success: false, error: 'Invalid settings payload' }, 400);
    }

    const { hasAssistant, hasCustomerDetails } = await ensureSettingsFeatureColumns(env.DB);
    const now = new Date().toISOString();

    const setClauses = [
      'business_name = ?',
      'tagline = ?',
      'address = ?',
      'phone = ?',
      'email = ?',
      'currency_symbol = ?',
      'currency_code = ?',
      'tax_rate_percent = ?',
      'enable_tax = ?',
      'receipt_header_note = ?',
      'receipt_footer_note = ?',
      'receipt_paper_width = ?',
      'low_stock_threshold_default = ?',
      'updated_at = ?',
    ];
    const params: any[] = [
      String(settings.businessName || 'Diocres Hardware&Retail Solutions'),
      settings.tagline || null,
      settings.address || null,
      settings.phone || null,
      settings.email || null,
      String(settings.currencySymbol || 'TSh'),
      String(settings.currencyCode || 'TZS'),
      Number(settings.taxRatePercent) || 0,
      settings.enableTax ? 1 : 0,
      settings.receiptHeaderNote || null,
      settings.receiptFooterNote || null,
      String(settings.receiptPaperWidth || '80mm'),
      Number(settings.lowStockThresholdDefault) || 5,
      now,
    ];

    if (hasAssistant) {
      setClauses.push('enable_sales_assistant = ?');
      params.push(settings.enableSalesAssistant ? 1 : 0);
    }
    if (hasCustomerDetails) {
      setClauses.push('enable_customer_details = ?');
      params.push(settings.enableCustomerDetails ? 1 : 0);
    }

    await env.DB.prepare(`UPDATE settings SET ${setClauses.join(', ')} WHERE id = 'global'`)
      .bind(...params)
      .run();

    const updated = await env.DB.prepare("SELECT * FROM settings WHERE id = 'global'").first();
    return jsonResponse({ success: true, settings: updated });
  } catch (error: any) {
    return jsonResponse(
      { success: false, error: error?.message || 'Failed to update settings' },
      500
    );
  }
}
