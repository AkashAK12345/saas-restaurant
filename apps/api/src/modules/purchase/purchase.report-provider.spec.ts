import { describe, it, expect } from 'vitest';
import { sentLabel } from './purchase.report-provider.js';

describe('Purchase report helpers', () => {
  it('reads WhatsApp sent as sent over all', () => {
    expect(sentLabel(0, 0)).toBe('0/0');
    expect(sentLabel(3, 4)).toBe('3/4');
  });
});
