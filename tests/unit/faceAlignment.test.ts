import { describe, expect, it } from 'vitest';
import { alignByFaces, misalignedFrames, scoreAlignment } from '../../src/core/faceAlignment';
import { apply } from '../../src/core/geometry';
import type { Mat3 } from '../../src/types';
import type { Face } from '../../src/types';
import { landmarkGrid, makeFace, makeFrame } from './factories';

describe('faceAlignment', () => {
  // a row-and-a-half of faces; frame B = frame A scaled 1.08, rotated 2°, shifted (camera moved)
  const T: Mat3 = [
    1.08 * Math.cos(0.035),
    -1.08 * Math.sin(0.035),
    140,
    1.08 * Math.sin(0.035),
    1.08 * Math.cos(0.035),
    -60,
    0,
    0,
    1,
  ];
  const xs = [100, 260, 420, 580, 740, 900, 180, 500, 820];
  const ys = [300, 310, 295, 305, 300, 310, 520, 530, 515];
  const mk = (cx: number, cy: number, m: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]) => {
    const l = landmarkGrid(cx, cy, 80).map((p) => apply(m, p));
    const c = apply(m, [cx, cy]),
      w = 80 * Math.hypot(m[0], m[3]);
    return { landmarks: l, box: { x: c[0] - w / 2, y: c[1] - w / 2, w, h: w } };
  };

  it('recovers a camera move from faces even when some people moved or were missed', () => {
    const A = xs.map((x, i) => mk(x, ys[i]));
    const B = xs.map((x, i) => mk(x, ys[i], T));
    B.splice(2, 1); // missed detection in B
    A[5] = mk(xs[5] + 150, ys[5]); // one person moved
    const r = alignByFaces(A, B)!;
    expect(r.matched).toBe(7);
    const p = apply(r.m, [500, 400]),
      q = apply(T, [500, 400]);
    expect(Math.hypot(p[0] - q[0], p[1] - q[1])).toBeLessThan(2);
    // a background-only transform that is off by a face width lines up far fewer faces
    const off: Mat3 = [T[0], T[1], T[2] + 90, T[3], T[4], T[5], 0, 0, 1];
    expect(scoreAlignment(off, A, B).matched).toBeLessThan(r.matched);
  });

  it('declines with too few faces', () => {
    expect(alignByFaces([mk(100, 100), mk(300, 100)], [mk(100, 100, T), mk(300, 100, T)])).toBeNull();
  });
});

describe('misalignedFrames', () => {
  // five people in a row; `shift` moves everyone in a frame by that many face widths
  const burst = (shifts: number[]) => {
    const frames = shifts.map((_, i) => makeFrame(`f${i}`));
    const faces: Record<string, Face> = {};
    shifts.forEach((shift, fi) =>
      [100, 300, 500, 700, 900].forEach((x, i) => (faces[`f${fi}:${i}`] = makeFace(`f${fi}`, i, x + shift * 100, 300))),
    );
    return { frames, faces };
  };

  it('leaves out frames whose faces do not line up with the reference', () => {
    const { frames, faces } = burst([0, 0, 0, 0, 1]);
    expect([...misalignedFrames(frames, faces, 'f2')]).toEqual(['f4']);
  });

  it('keeps every frame when too few would remain', () => {
    const { frames, faces } = burst([0, 0, 1, 1]);
    expect(misalignedFrames(frames, faces, 'f0').size).toBe(0);
  });
});
