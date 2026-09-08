/**
 * Money presentation for the banquet screens.
 *
 * THE WIRE FORMAT IS ALWAYS INTEGER MINOR UNITS. Division happens in exactly
 * one place — `formatMinor`, for display — and multiplication in exactly one
 * place — `toMinor`, when reading an operator's input. Nothing else in the
 * frontend touches a fractional amount, so no rounding drift can reach the
 * API.
 *
 * `toMinor` parses the STRING the operator typed rather than a float:
 * "1250.50" becomes 125050 by shifting digits, never by multiplying 1250.5 by
 * 100 (which is 125049.99999999999 for some values).
 */

/** Minor-unit digits for a currency — 2 for INR/USD, 0 for JPY, and so on. */
export function minorUnitDigits(currency: string): number {
  try {
    return (
      new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2; // unknown code: assume the common case rather than crashing a screen
  }
}

/** For DISPLAY only. e.g. formatMinor(1_250_000, 'INR') → "₹12,500.00". */
export function formatMinor(minor: number, currency: string, locale?: string): string {
  const digits = minorUnitDigits(currency);
  const value = minor / 10 ** digits;
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(digits)}`;
  }
}

/**
 * Parse what an operator typed into whole minor units.
 * Returns null for anything that is not a plain, non-negative amount.
 */
export function toMinor(input: string, currency: string): number | null {
  const trimmed = input.trim().replace(/,/g, '');
  if (!/^\d*(\.\d*)?$/.test(trimmed) || trimmed === '' || trimmed === '.') return null;

  const digits = minorUnitDigits(currency);
  const [whole, fraction = ''] = trimmed.split('.');
  if (fraction.length > digits) return null; // more precision than the currency has

  const padded = (fraction + '0'.repeat(digits)).slice(0, digits);
  const combined = `${whole || '0'}${padded}`;
  const minor = Number.parseInt(combined, 10);
  return Number.isSafeInteger(minor) ? minor : null;
}
