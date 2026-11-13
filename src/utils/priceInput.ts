/**
 * Format a number with thousands separators as user types
 * e.g., "10000" becomes "10,000"
 */
export function formatPriceInput(value: string): string {
  // Remove any non-digit characters except decimal point
  const clean = value.replace(/[^\d.]/g, '');
  
  // Prevent multiple decimal points
  const parts = clean.split('.');
  if (parts.length > 2) {
    return parts[0] + '.' + parts.slice(1).join('');
  }
  
  // Split into whole and decimal parts
  const whole = parts[0];
  const decimal = parts[1];
  
  // Format whole number part with commas
  const formattedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  
  // Rejoin with decimal if present
  return decimal !== undefined ? `${formattedWhole}.${decimal}` : formattedWhole;
}

/**
 * Parse a formatted price string back to a number
 * e.g., "10,000" becomes 10000
 */
export function parsePriceInput(value: string): number {
  return parseFloat(value.replace(/,/g, '')) || 0;
}

/**
 * Format a number to display with commas
 * e.g., 10000 becomes "10,000"
 */
export function formatNumberWithCommas(value: number | string): string {
  const num = typeof value === 'string' ? parseFloat(value.replace(/,/g, '')) : value;
  if (isNaN(num)) return '0';
  return num.toLocaleString('en-US');
}
