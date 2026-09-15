import { describe, it, expect } from 'vitest';
import { sumMetrics, sumSeries } from './dashboard.service.js';

describe('sumMetrics', () => {
  it('adds counts and same-currency money, and names what cannot be added', () => {
    const { metrics, notSummed } = sumMetrics([
      [
        { key: 'seated', label: 'Seated', value: 2, type: 'number' },
        { key: 'wait', label: 'Average wait', value: 300, type: 'duration' },
      ],
      [
        { key: 'seated', label: 'Seated', value: 3, type: 'number' },
        { key: 'wait', label: 'Average wait', value: 900, type: 'duration' },
      ],
    ]);
    expect(metrics).toEqual([{ key: 'seated', label: 'Seated', value: 5, type: 'number' }]);
    expect(notSummed).toEqual(['Average wait']);
  });
});

describe('sumSeries', () => {
  const keys = [
    { key: 'registered', label: 'Walked in' },
    { key: 'seated', label: 'Seated' },
  ];

  it('returns undefined when no branch has a series', () => {
    expect(sumSeries([])).toBeUndefined();
  });

  it('adds date by date, keeps dates only some branches have, and orders them', () => {
    const summed = sumSeries([
      {
        keys,
        points: [
          { date: '2026-03-09', values: { registered: 1, seated: 0 } },
          { date: '2026-03-10', values: { registered: 2, seated: 1 } },
        ],
      },
      {
        keys,
        points: [
          { date: '2026-03-10', values: { registered: 1, seated: 1 } },
          { date: '2026-03-11', values: { registered: 4, seated: 3 } },
        ],
      },
    ]);
    expect(summed).toEqual({
      keys,
      points: [
        { date: '2026-03-09', values: { registered: 1, seated: 0 } },
        { date: '2026-03-10', values: { registered: 3, seated: 2 } },
        { date: '2026-03-11', values: { registered: 4, seated: 3 } },
      ],
    });
  });

  it('fills a key one branch lacks with zero rather than dropping it', () => {
    const summed = sumSeries([
      { keys: [keys[0]], points: [{ date: '2026-03-10', values: { registered: 2 } }] },
      { keys, points: [{ date: '2026-03-10', values: { registered: 1, seated: 1 } }] },
    ]);
    expect(summed!.points).toEqual([{ date: '2026-03-10', values: { registered: 3, seated: 1 } }]);
  });
});
