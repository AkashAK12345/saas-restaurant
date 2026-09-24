import { describe, it, expect } from 'vitest';
import { averageRateMinor, sentLabel } from './purchase.report-provider.js';

describe('Purchase report helpers', () => {
  it('reads WhatsApp sent as sent over all', () => {
    expect(sentLabel(0, 0)).toBe('0/0');
    expect(sentLabel(3, 4)).toBe('3/4');
  });

  it('averages the rate over the quantity bought, in whole minor units', () => {
    // 402.56 kg for ₹3,34,124.80 is ₹830.00 a kg.
    expect(averageRateMinor(33_412_480, 402.56)).toBe(83_000);
    expect(averageRateMinor(0, 0)).toBe(0);
  });
});
