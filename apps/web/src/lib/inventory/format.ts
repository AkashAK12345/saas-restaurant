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

/** A typed rupee amount ("2,000", "33.5") in paise, or null if it is not one. */
export function parseRupees(text: string): number | null {
  const s = text.trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

/** A typed quantity above zero with at most three decimals, or null. */
export function parseQuantity(text: string): number | null {
  const s = text.trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,3})?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}

/** Paise as a plain rupee figure for an input: 200000 -> "2000", 3350 -> "33.5". */
export function rupeesInput(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return '';
  return String(minor / 100);
}

const STOCK_FRACTION = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 3 });

/** Stock on hand as the transfer list shows it: "56", "11.20", "825.15". */
export function stockFigure(value: number): string {
  return Number.isInteger(value) ? QTY.format(value) : STOCK_FRACTION.format(value);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TIME = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });

/** "28 Sep" — three letters always ("Sept" is what some locales give). */
export function dayMonth(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "28 Sep, 11:43 AM". */
export function dayTime(iso: string): string {
  return `${dayMonth(iso)}, ${TIME.format(new Date(iso))}`;
}
