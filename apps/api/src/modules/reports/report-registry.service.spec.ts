import { describe, it, expect, beforeEach } from 'vitest';
import { ReportRegistry } from './report-registry.service.js';
import { PERMISSION_KEYS } from '../../common/authorization/permission-keys.js';
import type { ReportDefinition, ReportProvider, ReportResult } from './report-contract.js';

function provider(key: string): ReportProvider {
  const definition: ReportDefinition = {
    key,
    name: key,
    description: `${key} description`,
    domain: key.split('.')[0],
    scope: 'branch',
    kind: 'rows',
    permission: PERMISSION_KEYS.QUEUE_VIEW,
    columns: [{ key: 'a', label: 'A', type: 'string' }],
    exportable: true,
  };
  return {
    definition,
    run: async (): Promise<ReportResult> => ({ rows: [], total: 0 }),
  };
}

describe('ReportRegistry', () => {
  let registry: ReportRegistry;

  beforeEach(() => {
    registry = new ReportRegistry();
  });

  it('registers and returns a provider by key', () => {
    const queue = provider('queue.summary');
    registry.register(queue);

    expect(registry.has('queue.summary')).toBe(true);
    expect(registry.get('queue.summary')).toBe(queue);
  });

  it('returns undefined for a key nobody registered', () => {
    expect(registry.get('pos.sales')).toBeUndefined();
    expect(registry.has('pos.sales')).toBe(false);
  });

  // Two modules silently claiming the same key would make which report runs
  // depend on module load order.
  it('refuses a duplicate key', () => {
    registry.register(provider('queue.summary'));
    expect(() => registry.register(provider('queue.summary'))).toThrow(/already registered/i);
  });

  it.each([
    'queue',
    'Queue.Summary',
    'queue.summary.extra',
    '1queue.summary',
    'queue summary',
    'queue.',
  ])('rejects the malformed key %j', (key) => {
    expect(() => registry.register(provider(key))).toThrow(/invalid report key/i);
  });

  it('lists definitions in a stable order regardless of registration order', () => {
    registry.register(provider('tasks.completion'));
    registry.register(provider('banquet.bookings'));
    registry.register(provider('queue.summary'));

    expect(registry.definitions().map((d) => d.key)).toEqual([
      'banquet.bookings',
      'queue.summary',
      'tasks.completion',
    ]);
  });

  // The engine is domain-agnostic on purpose: a module the registry has never
  // heard of registers exactly like the ones that shipped with it.
  it('accepts a report from a module the engine knows nothing about', () => {
    registry.register(provider('inventory.stock_movements'));
    expect(registry.definitions().map((d) => d.key)).toContain('inventory.stock_movements');
  });
});
