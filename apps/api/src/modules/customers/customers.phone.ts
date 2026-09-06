/**
 * Phone normalization for Customer.
 *
 * The stored value is what the (company_id, phone) unique index compares, so
 * two entries of the same number typed differently ("+91 98765-43210" and
 * "9876543210") must collapse to the same string BEFORE they reach the database.
 *
 * Rules — deliberately conservative, not a full E.164 parser:
 *   - trim; strip spaces, dashes, dots and parentheses
 *   - a leading "+" is preserved (international prefix); "00" is rewritten to "+"
 *   - everything remaining must be digits, 6–15 of them (ITU-T E.164 max)
 *
 * No country-code inference: the same digits typed with and without "+91"
 * are two different values. Deciding a company default country belongs to
 * Roadmap Phase 2 (Master Data), not to this foundation.
 *
 * Returns null for an invalid input so the caller can raise a validation error
 * with a stable message rather than a partial normalization landing in the DB.
 */
export function normalizePhone(raw: string): string | null {
  let value = raw.trim().replace(/[\s\-.()]/g, '');
  if (value.startsWith('00')) value = '+' + value.slice(2);

  if (!/^\+?\d{6,15}$/.test(value)) return null;
  return value;
}
