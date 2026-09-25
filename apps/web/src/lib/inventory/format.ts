/**
 * Inventory's number formats. Money is integer minor units (paise), as
 * everywhere in SAMCO.
 */

const INR_WHOLE = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const QTY = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });

/** Two decimals, trailing zeros kept: "11.67", "12.10". */
const two = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

/**
 * A headline amount the Indian way: "₹11.67L" for lakhs, "₹1.24Cr" for
 * crores, and the plain rupee figure below a lakh ("₹85,400"). Other
 * currencies are shown whole, in their own symbol.
 */
export function compactMoney(minor: number, currency = 'INR'): string {
  const major = minor / 100;
  if (currency !== 'INR') {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(major);
  }
  const sign = major < 0 ? '-' : '';
  const abs = Math.abs(major);
  if (abs >= 1e7) return `${sign}₹${two(abs / 1e7)}Cr`;
  if (abs >= 1e5) return `${sign}₹${two(abs / 1e5)}L`;
  return INR_WHOLE.format(major);
}

/** A quantity to at most three decimals, or a dash for nothing. */
export function quantity(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : QTY.format(value);
}
