// functions/api/ai/parse-sale.ts
import {
  parseSwahiliPrice,
  parseQuantity,
  parseSpokenQuantity,
  isDecimalUnit,
} from './numbers';

interface Env {
  DB: D1Database;
  GROQ_API_KEY: string;
}

const GROQ_BASE = 'https://api.groq.com/openai/v1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Device-ID',
  'Access-Control-Max-Age': '86400',
};

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

export const onRequestOptions: PagesFunction<Env> = async () => {
  return new Response(null, { status: 204, headers: corsHeaders });
};

// ── 1. Transcribe ──────────────────────────────────────────────
async function transcribe(env: Env, audio: File): Promise<string> {
  const fd = new FormData();
  fd.append('file', audio, audio.name || 'audio.webm');
  fd.append('model', 'whisper-large-v3-turbo');
  fd.append('language', 'sw');
  fd.append('response_format', 'json');
  const r = await fetch(`${GROQ_BASE}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` },
    body: fd,
  });
  if (!r.ok) throw new Error(`STT ${r.status}: ${await r.text()}`);
  return ((await r.json()) as any).text?.trim() ?? '';
}

// ── 2. Extract (multi-item, category-agnostic) ─────────────────
async function extract(env: Env, transcript: string, shopLabel: string | null) {
  const systemPrompt = `You extract structured sale data from a shopkeeper's spoken sentence.
The shop may sell ANY product category (phones, groceries, hardware, clothes, electronics, etc.). Do not assume phones.

Return ONLY JSON:
{
  "items": [
    {
      "productName": string,
      "quantityText": string,          // RAW phrase, verbatim from speech
      "priceText": string,             // RAW price phrase
      "attributes": { "<key>": "<value>" }
    }
  ],
  "confidence": number  // 0..1
}

Rules:
- Support MULTIPLE items if the seller lists several products in one sentence.
- quantityText: return the RAW quantity phrase the seller said, verbatim.
  Examples: "moja na nusu", "robo tatu", "1.5", "mita moja na nusu",
  "lita mbili na robo", "kilo tatu", "vitano".
  If the seller says a measurement + unit (e.g. "mita moja na nusu"),
  include BOTH the number phrase and the unit in quantityText.
  Do NOT convert fractions to decimals — the server does that.
  Return "" only when no quantity or measurement is mentioned at all.
  Never invent a quantity.
- priceText: return the raw phrase. Do NOT compute the number.
  Examples: "laki nne na hamsini", "450,000", "elfu tatu".
- attributes: only what the seller actually said. Keys are freeform.
  Examples: {"ram":"8GB"}, {"size":"XL"}, {"color":"red"}, {"weight":"2kg"}.
- Never add a payment method or "sold" status.
- If shop context is provided, use it only to disambiguate product names.
${shopLabel ? `Shop: ${shopLabel}` : ''}`;

  const r = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: transcript },
      ],
    }),
  });
  if (!r.ok) throw new Error(`LLM ${r.status}: ${await r.text()}`);
  const data: any = await r.json();
  try { return JSON.parse(data.choices?.[0]?.message?.content ?? '{}'); }
  catch { return {}; }
}

// ── 3. Product matcher (D1, shop-scoped) ───────────────────────
async function matchProduct(
  env: Env,
  name: string,
  shopIds: string[]
): Promise<any | null> {
  const needle = name.trim();
  if (!needle) return null;

  const placeholders = shopIds.map(() => '?').join(',');
  const shopClause = shopIds.length
    ? `AND shop_id IN (${placeholders})`
    : '';

  // Pass 1: substring match
  let row = await env.DB.prepare(
    `SELECT id, name, selling_price, current_stock, category_id, shop_id, unit
       FROM products
      WHERE status = 'ACTIVE' ${shopClause}
        AND LOWER(name) LIKE LOWER(?)
      ORDER BY LENGTH(name) ASC
      LIMIT 1`
  ).bind(...shopIds, `%${needle}%`).first();

  // Pass 2: token-based AND match
  if (!row) {
    const tokens = needle.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length) {
      const clauses = tokens.map(() => `LOWER(name) LIKE ?`).join(' AND ');
      row = await env.DB.prepare(
        `SELECT id, name, selling_price, current_stock, category_id, shop_id, unit
           FROM products
          WHERE status = 'ACTIVE' ${shopClause} AND ${clauses}
          LIMIT 1`
      ).bind(...shopIds, ...tokens.map(t => `%${t}%`)).first();
    }
  }
  return row ?? null;
}

// ── 4. Quantity resolution helper ──────────────────────────────
/**
 * Given a spoken quantity phrase + the matched product's unit,
 * return a decimal quantity. Falls back to recovering from the
 * transcript only when the phrase is empty AND the unit is measured.
 */
function resolveQuantity(
  quantityText: string | undefined,
  productUnit: string | null | undefined,
  transcript: string
): number {
  const raw = (quantityText ?? '').trim();

  if (raw) {
    const parsed = parseQuantity(raw, 1);
    if (parsed !== 1 || /moja|1\b/.test(raw)) return parsed;
  }

  if (isDecimalUnit(productUnit ?? '')) {
    const recovered = parseSpokenQuantity(transcript);
    if (recovered !== null) return recovered;
  }

  return 1;
}

// ── 5. Main handler ────────────────────────────────────────────
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    // 1. Auth
    const auth = request.headers.get('Authorization') ?? '';
    if (!auth.startsWith('Bearer ')) {
      return json({ error: 'Unauthorized' }, 401);
    }

    // 2. Content-Type guard — MUST run before request.formData()
    //    Without this, a bare POST throws "Parsing a Body as FormData
    //    requires a Content-Type header" and becomes a 500.
    const contentType = request.headers.get('Content-Type') ?? '';
    if (!contentType.includes('multipart/form-data')) {
      return json(
        { error: 'Expected multipart/form-data with "audio" field' },
        400
      );
    }

    // 3. Parse form safely
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return json({ error: 'Malformed form data' }, 400);
    }

    // 4. Validate audio
    const audio = form.get('audio');
    if (!(audio instanceof File) || audio.size === 0) {
      return json({ error: 'Missing audio' }, 400);
    }

    const requestedShopId = (form.get('shopId') as string | null) || null;

    // TODO: verify the caller's assignedShopIds from the users table.
    const shopIds: string[] = requestedShopId ? [requestedShopId] : [];

    // 5. Transcribe
    const transcript = await transcribe(env, audio);
    if (!transcript) return json({ error: 'Empty transcript' }, 422);

    // 6. Extract
    let shopLabel: string | null = null;
    if (requestedShopId) {
      const s: any = await env.DB.prepare(
        `SELECT name FROM shops WHERE id = ? LIMIT 1`
      ).bind(requestedShopId).first();
      shopLabel = s?.name ?? null;
    }
    const parsed = await extract(env, transcript, shopLabel);

    // 7. Resolve each item deterministically
    const warnings: string[] = [];
    const rawItems: any[] = Array.isArray(parsed.items) ? parsed.items : [];

    const items = await Promise.all(
      rawItems.map(async (it) => {
        const row = await matchProduct(env, it.productName ?? '', shopIds);
        const productUnit: string | null = row?.unit ?? null;

        const qty = resolveQuantity(it.quantityText, productUnit, transcript);
        const price = parseSwahiliPrice(it.priceText ?? '');

        const stock = Number(row?.current_stock ?? 0);
        const inStock = !!row && stock >= qty;

        if (!row) warnings.push(`Product not found: "${it.productName}"`);
        if (!price) warnings.push(`No price detected for "${it.productName}"`);
        if (row && stock < qty) {
          warnings.push(
            `Only ${stock}${productUnit ? ' ' + productUnit : ''} in stock for "${row.name}" (asked ${qty})`
          );
        }
        if (
          row &&
          isDecimalUnit(productUnit ?? '') &&
          Number.isInteger(qty) &&
          /nusu|robo|theluthi/i.test(transcript)
        ) {
          warnings.push(
            `Quantity for "${row.name}" may be fractional — please double-check (${qty} ${productUnit})`
          );
        }

        return {
          productId: row?.id ?? null,
          productName: row?.name ?? it.productName ?? null,
          quantity: qty,
          unit: productUnit,
          unitPrice: price ?? row?.selling_price ?? null,
          inStock,
          stockQty: stock,
          attributes: it.attributes ?? {},
        };
      })
    );

    if (items.length === 0) {
      return json({
        error: 'Could not identify any product in the recording',
        transcript,
      }, 422);
    }

    const draft = {
      items,
      saleType: 'NEW_PRODUCT_SALE' as const,
      paymentMethod: null,
      shopId: requestedShopId,
    };

    const confidence =
      typeof parsed.confidence === 'number' ? parsed.confidence : 0.5;

    const needsManualReview =
      confidence < 0.6 ||
      warnings.length > 0 ||
      items.some(i => !i.productId || !i.unitPrice || i.quantity <= 0);

    return json({ draft, transcript, needsManualReview, warnings });
  } catch (err: any) {
    console.error('[parse-sale]', err);
    return json({ error: err?.message ?? 'Internal error' }, 500);
  }
};
