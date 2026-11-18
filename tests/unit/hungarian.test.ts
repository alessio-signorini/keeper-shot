import { describe, expect, it } from 'vitest';
import { hungarian } from '../../src/core/hungarian';

describe('hungarian', () => {
  it('finds the min-cost assignment', () => {
    expect(
      hungarian([
        [4, 1, 3],
        [2, 0, 5],
        [3, 2, 2],
      ]),
    ).toEqual([1, 0, 2]);
  });
  it('handles more rows than columns', () => {
    const r = hungarian([[1], [0.5]]);
    expect(r.filter((x) => x >= 0)).toEqual([0]);
  });
});
