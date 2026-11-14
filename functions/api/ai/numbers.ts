// functions/api/ai/numbers.ts

// ── Whole-number words ────────────────────────────────────────
const NUM_WORDS: Record<string, number> = {
  sifuri: 0, moja: 1, mbili: 2, tatu: 3, nne: 4, tano: 5,
  sita: 6, saba: 7, nane: 8, tisa: 9, kumi: 10,
  'kumi na moja': 11, 'kumi na mbili': 12, 'kumi na tatu': 13,
  'kumi na nne': 14, 'kumi na tano': 15,
  ishirini: 20, thelathini: 30, arobaini: 40, hamsini: 50,
  sitini: 60, sabini: 70, themanini: 80, tisini: 90,
  mia: 100, elfu: 1000, laki: 100000, milioni: 1000000,
};

// ── Fraction words → decimal value ────────────────────────────
// "nusu"=0.5, "robo"=0.25, "robo tatu"=0.75, "theluthi"=0.333, ...
const FRACTION_WORDS: Record<string, number> = {
  nusu: 0.5,
  robo: 0.25,
  'robo tatu': 0.75,
  'robo mbili': 0.5,
  'robo moja': 0.25,
  theluthi: 1 / 3,
  'theluthi mbili': 2 / 3,
  tano: 0.2, // rare; only if preceded by "moja na"
};

/**
 * Parse a numeric phrase that MAY contain fractions.
 * Handles both English decimal notation ("1.5", "1,75") and
 * Swahili spoken fractions ("moja na nusu", "moja na robo tatu").
 *
 * Returns a float (e.g. 1.25, 1.5, 1.75) or null if unparseable.
 */
export function parseSpokenQuantity(text: string): number | null {
  if (!text) return null;
  const raw = text.toLowerCase().trim();

  // ── 1. Direct decimal in digits: "1.5", "1,75", "0.25" ─────
  // Normalize comma-as-decimal (European) OR comma-as-thousands first.
  // Rule: if there's a single comma with 1-2 digits after it → decimal.
  const cleaned = raw
    .replace(/(\d),(\d{1,2})\b/g, '$1.$2')   // 1,75 → 1.75
    .replace(/(\d),(?=\d{3}\b)/g, '');       // 1,000 → 1000

  const decimalMatch = cleaned.match(/\d+(?:\.\d+)?/);
  // Only trust a bare digit match if the text has NO fraction words
  // (otherwise "1.5 mita moja na nusu" would be double-counted).
  const hasFractionWord = /nusu|robo|theluthi/.test(raw);
  if (decimalMatch && !hasFractionWord) {
    const n = parseFloat(decimalMatch[0]);
    if (Number.isFinite(n)) return n;
  }

  // ── 2. Split into "whole" and "fraction" sections ─────────
  // Trigger words that start the fraction part:
  //   na nusu | na robo | na robo tatu | na theluthi mbili ...
  const fracRe = /\bna\s+((?:robo|theluthi)(?:\s+(?:tatu|mbili|moja))?|nusu)\b/;
  const fracMatch = raw.match(fracRe);

  let wholePart = raw;
  let fraction = 0;

  if (fracMatch) {
    wholePart = raw.slice(0, fracMatch.index).trim();
    const fracWord = fracMatch[1].trim();
    fraction = FRACTION_WORDS[fracWord] ?? 0;
  }

  // ── 3. Parse the whole-number part ────────────────────────
  let whole = 0;

  // Digit first (e.g. "1.5", "2", "10")
  const wDigits = wholePart.match(/\d+(?:\.\d+)?/);
  if (wDigits) {
    whole = parseFloat(wDigits[0]);
  } else {
    // Spoken whole words
    let total = 0, current = 0, matched = false;
    for (const tok of wholePart.split(/\s+/)) {
      if (!tok || tok === 'na' || tok === 'ya' || tok === 'za') continue;
      const n = NUM_WORDS[tok];
      if (n === undefined) continue;
      matched = true;
      if (n >= 100) { current = (current || 1) * n; total += current; current = 0; }
      else current += n;
    }
    whole = total + current;
    if (!matched && !fracMatch) return null;
  }

  const result = whole + fraction;
  return Number.isFinite(result) && result > 0 ? result : null;
}

/**
 * Price parser — MONEY only. "laki nne na hamsini" → 450000,
 * "laki nne na nusu" → 450000, "450,000" → 450000.
 * Keeps the old "nusu = +50000" convention because for prices
 * "X na nusu" means X + 50,000 TZS (not X + 0.5).
 */
export function parseSwahiliPrice(text: string): number | null {
  if (!text) return null;
  const raw = text.toLowerCase().trim();

  // Direct digits — support thousands commas
  const cleaned = raw.replace(/,/g, '');
  const digits = cleaned.match(/\d{3,}/);
  if (digits) return parseInt(digits[0], 10);

  // Spoken words
  let total = 0, current = 0, matched = false;
  const tokens = raw.replace(/[,.]/g, ' ').split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!tok || tok === 'na') continue;

    // "laki nne na nusu" → +50,000
    if (tok === 'nusu') { current += 50000; matched = true; continue; }

    const n = NUM_WORDS[tok];
    if (n === undefined) continue;
    matched = true;
    if (n >= 100) { current = (current || 1) * n; total += current; current = 0; }
    else current += n;
  }
  const result = total + current;
  return matched && result > 0 ? result : null;
}

/**
 * Quantity parser — for units (mita, lita, kg, cm, pcs).
 * Supports decimals up to 9999. Falls back to 1.
 * Used by the voice endpoint when a decimal unit is detected.
 */
export function parseQuantity(raw: unknown, fallback = 1): number {
  if (raw === null || raw === undefined || raw === '') return fallback;

  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw >= 0.01 && raw <= 9999
      ? Math.round(raw * 1000) / 1000
      : fallback;
  }

  if (typeof raw === 'string') {
    const n = parseSpokenQuantity(raw);
    if (n !== null && n >= 0.01 && n <= 9999) {
      return Math.round(n * 1000) / 1000;
    }
  }
  return fallback;
}

/** Unit-detection helper (mirrors your frontend regex) */
const DECIMAL_UNIT_REGEX =
  /(kg|kilogram|g\b|gram|liter|litre|^l$|\bl\b|ml|milliliter|millilitre|meter|mita|metre|^m$|\bm\b|sentimita|cm|oz|lb)/i;

export function isDecimalUnit(unit?: string): boolean {
  if (!unit) return false;
  return DECIMAL_UNIT_REGEX.test(unit.trim());
}
