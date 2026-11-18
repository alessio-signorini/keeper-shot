import { describe, expect, it } from 'vitest';
import { apply, compose, convexHull, expandBox, fitSimilarity, invert, iou } from '../../src/core/geometry';
import type { Mat3, Pt } from '../../src/types';

describe('geometry', () => {
  it('composes and inverts', () => {
    const a: Mat3 = [2, 0, 5, 0, 2, -3, 0, 0, 1];
    const b: Mat3 = [0.9, -0.1, 4, 0.1, 0.9, 2, 0, 0, 1];
    const m = compose(a, b);
    const p: Pt = [10, 20];
    expect(apply(m, p)[0]).toBeCloseTo(apply(a, apply(b, p))[0]);
    const r = apply(compose(invert(m), m), p);
    expect(r[0]).toBeCloseTo(10);
    expect(r[1]).toBeCloseTo(20);
  });
  it('fits a similarity exactly', () => {
    const src: Pt[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [5, 3],
    ];
    const t: Mat3 = [
      1.5 * Math.cos(0.3),
      -1.5 * Math.sin(0.3),
      7,
      1.5 * Math.sin(0.3),
      1.5 * Math.cos(0.3),
      -4,
      0,
      0,
      1,
    ];
    const { m, rms } = fitSimilarity(
      src,
      src.map((p) => apply(t, p)),
    );
    expect(rms).toBeLessThan(1e-9);
    m.forEach((v, i) => expect(v).toBeCloseTo(t[i], 6));
  });
  it('computes iou', () => {
    expect(iou({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 0, w: 10, h: 10 })).toBeCloseTo(1 / 3);
  });
  it('computes a convex hull without interior points', () => {
    const hull = convexHull([
      [0, 0],
      [4, 0],
      [2, 1],
      [4, 4],
      [0, 4],
      [2, 2],
    ]);
    expect(hull).toHaveLength(4);
    expect(hull).not.toContainEqual([2, 2]);
  });
  it('expands a box about its centre and clips it to the canvas', () => {
    expect(expandBox({ x: 10, y: 10, w: 10, h: 10 }, 2, 100, 100)).toEqual({ x: 5, y: 5, w: 20, h: 20 });
    expect(expandBox({ x: 0, y: 90, w: 10, h: 10 }, 2, 100, 100)).toEqual({ x: 0, y: 85, w: 15, h: 15 });
  });
});
