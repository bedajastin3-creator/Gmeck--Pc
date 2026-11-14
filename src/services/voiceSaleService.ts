// src/services/voiceSaleService.ts
import { CloudflareApi } from './cloudflareApi';

// ── Types ─────────────────────────────────────────────────────
export interface VoiceSaleItem {
  productId: string | null;
  productName: string | null;
  quantity: number;
  unit: string | null;              // ← NEW: e.g. "mita", "lita", "pcs"
  unitPrice: number | null;
  inStock: boolean;
  stockQty: number;
  attributes: Record<string, string>;
}

export interface VoiceSaleResult {
  draft: {
    items: VoiceSaleItem[];
    saleType: 'NEW_PRODUCT_SALE';
    paymentMethod: null;
    shopId: string | null;
  };
  transcript: string;
  needsManualReview: boolean;
  warnings: string[];
}

// ── Helpers ───────────────────────────────────────────────────
const numOrNull = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
};

const numOr = (v: unknown, fallback: number): number => {
  const n = numOrNull(v);
  return n === null ? fallback : n;
};

const strOrNull = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length ? s : null;
};

const attributesObject = (v: unknown): Record<string, string> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (val === null || val === undefined) continue;
    out[k] = String(val);
  }
  return out;
};

/**
 * Normalizes a single item coming from the backend. Backend already
 * returns clean types, but this protects against:
 *  - numbers arriving as strings (rare LLM edge cases)
 *  - missing `unit` in older deployments
 *  - null attributes
 *  - quantity < 0 or NaN (clamped to 1)
 */
function normalizeItem(raw: any): VoiceSaleItem {
  const rawQty = numOr(raw?.quantity, 1);
  const quantity = rawQty > 0 ? rawQty : 1;

  return {
    productId: strOrNull(raw?.productId),
    productName: strOrNull(raw?.productName),
    quantity,
    unit: strOrNull(raw?.unit),
    unitPrice: numOrNull(raw?.unitPrice),
    inStock: Boolean(raw?.inStock),
    stockQty: numOr(raw?.stockQty, 0),
    attributes: attributesObject(raw?.attributes),
  };
}

function normalizeResult(raw: any): VoiceSaleResult {
  const items: VoiceSaleItem[] = Array.isArray(raw?.draft?.items)
    ? raw.draft.items.map(normalizeItem)
    : [];

  return {
    draft: {
      items,
      saleType: 'NEW_PRODUCT_SALE',
      paymentMethod: null,
      shopId: strOrNull(raw?.draft?.shopId),
    },
    transcript: typeof raw?.transcript === 'string' ? raw.transcript : '',
    needsManualReview: Boolean(raw?.needsManualReview),
    warnings: Array.isArray(raw?.warnings)
      ? raw.warnings.filter((w: unknown) => typeof w === 'string')
      : [],
  };
}

// ── Service ───────────────────────────────────────────────────
export class VoiceSaleService {
  /**
   * Send recorded audio to the AI parser and receive a normalized draft.
   *
   * @param audioBlob  The recorded audio (webm/opus preferred)
   * @param shopId     Optional shop scope; when supplied, matching is
   *                   restricted to products in that shop.
   */
  static async parseAudio(
    audioBlob: Blob,
    shopId: string | null
  ): Promise<VoiceSaleResult> {
    if (!audioBlob || audioBlob.size === 0) {
      throw new Error('No audio recorded');
    }

    const fd = new FormData();
    fd.append('audio', audioBlob, audioBlob.type.includes('mp4') ? 'sale.mp4' : 'sale.webm');
    if (shopId) fd.append('shopId', shopId);

    const token = CloudflareApi.getToken?.() ?? '';
    const headers: HeadersInit = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const baseUrl = CloudflareApi.getBaseUrl().replace(/\/+$/, '');
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/api/ai/parse-sale`, {
        method: 'POST',
        headers,
        body: fd,
      });
    } catch (netErr: any) {
      // Fetch-level failure (offline, DNS, aborted)
      throw new Error(
        netErr?.message?.includes('fetch')
          ? 'Network error — check your connection and try again'
          : netErr?.message ?? 'Could not reach the voice service'
      );
    }

    // Safe JSON parse — the endpoint might return HTML on a 5xx
    const payload: any = await res
      .json()
      .catch(() => ({ error: `Unexpected ${res.status} response` }));

    if (!res.ok) {
      const message =
        typeof payload?.error === 'string'
          ? payload.error
          : `Voice service failed (HTTP ${res.status})`;
      throw new Error(message);
    }

    return normalizeResult(payload);
  }
}
