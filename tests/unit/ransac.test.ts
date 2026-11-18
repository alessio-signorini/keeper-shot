import { describe, expect, it } from 'vitest';
import { apply } from '../../src/core/geometry';
import { ransacSimilarity } from '../../src/core/ransac';
import type { Mat3, Pt } from '../../src/types';

describe('ransacSimilarity', () => {
  it('recovers a similarity despite outliers', () => {
    const T: Mat3 = [
      1.05 * Math.cos(0.02),
      -1.05 * Math.sin(0.02),
      12,
      1.05 * Math.sin(0.02),
      1.05 * Math.cos(0.02),
      -7,
      0,
      0,
      1,
    ];
    const a: Pt[] = Array.from({ length: 80 }, (_, i) => [(i * 37) % 400, (i * 53) % 300]);
    const b = a.map((p, i): Pt => (i % 5 === 0 ? [p[0] + 60, p[1] - 40] : apply(T, p)));
    const r = ransacSimilarity(a, b)!;
    expect(r.inliers).toBe(64);
    const p = apply(r.m, [200, 150]);
    const q = apply(T, [200, 150]);
    expect(Math.hypot(p[0] - q[0], p[1] - q[1])).toBeLessThan(0.5);
  });
});
