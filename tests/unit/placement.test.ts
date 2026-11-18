import { describe, expect, it } from 'vitest';
import { planIncrementalUpdate, type SwapRegion } from '../../src/core/placement';

const box = (x: number) => ({ x, y: 0, w: 10, h: 10 });
const regions = (entries: [string, string, number][]) =>
  new Map<string, SwapRegion>(entries.map(([id, key, x]) => [id, { key, roi: box(x) }]));

describe('planIncrementalUpdate', () => {
  it('redoes a changed swap and, transitively, the swaps overlapping it', () => {
    const applied = regions([
      ['p1', 'a', 0],
      ['p2', 'b', 8],
      ['p3', 'c', 16],
      ['p4', 'd', 50],
    ]);
    const wanted = regions([
      ['p1', 'a2', 0],
      ['p2', 'b', 8],
      ['p3', 'c', 16],
      ['p4', 'd', 50],
    ]);
    const { redo } = planIncrementalUpdate(applied, wanted);
    expect([...redo].sort()).toEqual(['p1', 'p2', 'p3']);
  });

  it('restores the region of a removed swap without redoing distant ones', () => {
    const { dirty, redo } = planIncrementalUpdate(
      regions([
        ['p1', 'a', 0],
        ['p2', 'b', 50],
      ]),
      regions([['p2', 'b', 50]]),
    );
    expect(dirty).toEqual([box(0)]);
    expect(redo.size).toBe(0);
  });
});
