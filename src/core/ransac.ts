import * as C from '../config';
import type { Mat3, Pt } from '../types';
import { apply, fitSimilarity } from './geometry';

/** Deterministic seed so alignment (and therefore the output) is reproducible run to run. */
const SEED = 12345;

/** RANSAC similarity fit (fallback when the homography is implausible). */
export function ransacSimilarity(a: Pt[], b: Pt[], iters = 500): { m: Mat3; inliers: number; set: number[] } | null {
  const n = a.length;
  if (n < 2) return null;
  let best: { m: Mat3; set: number[] } | null = null;
  let seed = SEED;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let it = 0; it < iters; it++) {
    const i = Math.floor(rnd() * n);
    let j = Math.floor(rnd() * n);
    if (i === j) j = (j + 1) % n;
    const { m, rms } = fitSimilarity([a[i], a[j]], [b[i], b[j]]);
    if (!isFinite(rms)) continue;
    const set: number[] = [];
    for (let k = 0; k < n; k++) {
      const p = apply(m, a[k]);
      if (Math.hypot(p[0] - b[k][0], p[1] - b[k][1]) < C.RANSAC_THRESHOLD) set.push(k);
    }
    if (!best || set.length > best.set.length) best = { m, set };
  }
  if (!best || best.set.length < 2) return null;
  const refit = fitSimilarity(
    best.set.map((k) => a[k]),
    best.set.map((k) => b[k]),
  );
  const sc = Math.hypot(refit.m[0], refit.m[3]);
  if (sc < C.ALIGN_SCALE_MIN || sc > C.ALIGN_SCALE_MAX) return null;
  return { m: refit.m, inliers: best.set.length, set: best.set };
}
