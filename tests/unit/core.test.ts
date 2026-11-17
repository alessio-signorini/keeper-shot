import { describe, expect, it } from 'vitest';
import { apply, compose, fitSimilarity, invert, iou } from '../../src/core/geometry';
import { poseFromMatrix } from '../../src/core/pose';
import { estimateJpegQuality, estimateQualityFromTable } from '../../src/core/jpegQuality';
import { groupFaces, hungarian } from '../../src/core/group';
import { normalizeSharpness, scoreFace } from '../../src/core/score';
import { chooseBase, choosePick, swapFeasibility } from '../../src/core/select';
import type { Face, Frame, Mat3, Pt } from '../../src/types';

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
    const src: Pt[] = [[0, 0], [10, 0], [10, 10], [0, 10], [5, 3]];
    const t: Mat3 = [1.5 * Math.cos(0.3), -1.5 * Math.sin(0.3), 7, 1.5 * Math.sin(0.3), 1.5 * Math.cos(0.3), -4, 0, 0, 1];
    const { m, rms } = fitSimilarity(src, src.map((p) => apply(t, p)));
    expect(rms).toBeLessThan(1e-9);
    m.forEach((v, i) => expect(v).toBeCloseTo(t[i], 6));
  });
  it('computes iou', () => {
    expect(iou({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 0, w: 10, h: 10 })).toBeCloseTo(1 / 3);
  });
});

describe('pose', () => {
  it('extracts yaw from a rotation about Y', () => {
    const a = (30 * Math.PI) / 180;
    // column-major rotation about Y
    const d = [Math.cos(a), 0, -Math.sin(a), 0, 0, 1, 0, 0, Math.sin(a), 0, Math.cos(a), 0, 0, 0, 0, 1];
    const p = poseFromMatrix(d);
    expect(p.yaw).toBeCloseTo(30, 3);
    expect(p.pitch).toBeCloseTo(0, 3);
    expect(p.roll).toBeCloseTo(0, 3);
  });
});

describe('jpegQuality', () => {
  it('recovers quality 50 from the standard table (clamped)', () => {
    const zz = [16, 11, 12, 14, 12, 10, 16, 14, 13, 14, 18, 17, 16, 19, 24, 40, 26, 24, 22, 22, 24, 49, 35, 37, 29, 40, 58, 51, 61, 60, 57, 51,
      56, 55, 64, 72, 92, 78, 64, 68, 87, 69, 55, 56, 80, 109, 81, 87, 95, 98, 103, 104, 103, 62, 77, 113, 121, 112, 100, 120, 92, 101, 103, 99];
    expect(estimateQualityFromTable(zz)).toBe(0.85);
  });
  it('maps an all-ones table to the max', () => {
    expect(estimateQualityFromTable(new Array(64).fill(1))).toBe(0.97);
  });
  it('falls back without DQT', () => {
    expect(estimateJpegQuality(new Uint8Array([0xff, 0xd8, 0xff, 0xd9, 0, 0, 0, 0]))).toBe(0.92);
  });
});

function lm(cx: number, cy: number, size: number): Pt[] {
  // 478 points on a small grid around center; index-specific eye points are spread plausibly
  const pts: Pt[] = [];
  for (let i = 0; i < 478; i++) pts.push([cx + (((i * 37) % 100) / 100 - 0.5) * size, cy + (((i * 53) % 100) / 100 - 0.5) * size]);
  return pts;
}

function mkFace(frameId: string, i: number, cx: number, cy: number, o: Partial<Face> = {}, blend: Record<string, number> = {}): Face {
  const size = 100;
  const pose = o.pose ?? { yaw: 0, pitch: 0, roll: 0 };
  const l = lm(cx, cy, size);
  return {
    id: `${frameId}:${i}`, frameId, landmarks: l, refLandmarks: l,
    box: { x: cx - 50, y: cy - 50, w: 100, h: 100 }, refBox: { x: cx - 50, y: cy - 50, w: 100, h: 100 },
    blend, pose, sharpness: 1, score: scoreFace(blend, pose, 1), thumbKey: '', ...o,
  };
}

const fr = (id: string, inliers = 100): Frame => ({
  id, name: id, blobKey: id, width: 1000, height: 1000, toRef: [1, 0, 0, 0, 1, 0, 0, 0, 1], alignInliers: inliers, exif: {},
});

describe('hungarian', () => {
  it('finds the min-cost assignment', () => {
    expect(hungarian([[4, 1, 3], [2, 0, 5], [3, 2, 2]])).toEqual([1, 0, 2]);
  });
  it('handles more rows than columns', () => {
    const r = hungarian([[1], [0.5]]);
    expect(r.filter((x) => x >= 0)).toEqual([0]);
  });
});

describe('group', () => {
  it('groups jittered faces, handles misses and drops passers-by', () => {
    const frames = [fr('f0'), fr('f1'), fr('f2'), fr('f3'), fr('f4')];
    const faces: Record<string, Face> = {};
    const add = (f: Face) => (faces[f.id] = f);
    const xs = [100, 300, 500];
    frames.forEach((f, fi) => {
      xs.forEach((x, i) => {
        if (fi === 2 && i === 1) return; // missed detection
        add(mkFace(f.id, i, x + ((fi * 7) % 9) - 4, 200 + ((fi * 5) % 7) - 3));
      });
    });
    add(mkFace('f1', 9, 900, 200)); // passer-by, one frame
    const people = groupFaces(frames, faces);
    expect(people.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
    expect(Object.keys(people[1].faces)).toHaveLength(4);
    expect(Object.keys(people[0].faces)).toHaveLength(5);
  });
});

describe('score', () => {
  it('penalizes blinks hard', () => {
    const open = scoreFace({ mouthSmileLeft: 0.5, mouthSmileRight: 0.5 }, { yaw: 0, pitch: 0 }, 1);
    const blink = scoreFace({ eyeBlinkLeft: 0.9, eyeBlinkRight: 0.9, mouthSmileLeft: 0.5, mouthSmileRight: 0.5 }, { yaw: 0, pitch: 0 }, 1);
    expect(blink.total).toBeLessThan(open.total * 0.35);
  });
  it('flags a blink relative to the person\'s own most-open eyes', () => {
    const half = { eyeBlinkLeft: 0.45, eyeBlinkRight: 0.45 };
    expect(scoreFace(half, { yaw: 0, pitch: 0 }, 1, 0.6).total).toBeGreaterThan(0.5);
    expect(scoreFace(half, { yaw: 0, pitch: 0 }, 1, 0.9).total).toBeLessThan(0.3);
  });
  it('penalizes funny faces and head turn', () => {
    const base = scoreFace({ mouthSmileLeft: 0.6, mouthSmileRight: 0.6 }, { yaw: 0, pitch: 0 }, 1);
    const tongue = scoreFace({ mouthSmileLeft: 0.6, mouthSmileRight: 0.6, tongueOut: 0.5 }, { yaw: 0, pitch: 0 }, 1);
    const turned = scoreFace({ mouthSmileLeft: 0.6, mouthSmileRight: 0.6 }, { yaw: 30, pitch: 0 }, 1);
    expect(tongue.smile).toBeLessThan(base.smile);
    expect(turned.pose).toBeCloseTo(0.25);
  });
  it('normalizes sharpness within a cluster', () => {
    expect(normalizeSharpness([10, 20, 30])).toEqual([0, 0.5, 1]);
    expect(normalizeSharpness([5, 5])).toEqual([1, 1]);
  });
});

describe('select', () => {
  const blink = { eyeBlinkLeft: 0.9, eyeBlinkRight: 0.9, mouthSmileLeft: 0.5, mouthSmileRight: 0.5 };
  const good = { mouthSmileLeft: 0.5, mouthSmileRight: 0.5 };
  const setup = () => {
    const frames = [fr('f0'), fr('f1', 200)];
    const faces: Record<string, Face> = {};
    const add = (f: Face) => (faces[f.id] = f);
    // person 1 blinks in f0, fine in f1; person 2 fine in both
    add(mkFace('f0', 0, 100, 200, {}, blink));
    add(mkFace('f1', 0, 100, 200, {}, good));
    add(mkFace('f0', 1, 400, 200, {}, good));
    add(mkFace('f1', 1, 400, 200, {}, good));
    const people = groupFaces(frames, faces);
    return { frames, faces, people };
  };
  it('swaps eyes when only the eyes are bad', () => {
    const { faces, people } = setup();
    const c = choosePick(people[0], 'f0', faces);
    expect(c.pick?.mode).toBe('eyes');
    expect(c.pick?.faceId).toBe('f1:0');
  });
  it('picks the base frame needing the fewest swaps', () => {
    const { frames, faces, people } = setup();
    const b = chooseBase(frames, people, faces);
    expect(b.frameId).toBe('f1');
    expect(b.swaps).toBe(0);
  });
  it('disables candidates with too much pose change', () => {
    const a = mkFace('f0', 0, 100, 200, { pose: { yaw: 0, pitch: 0, roll: 0 } });
    const b = mkFace('f1', 0, 100, 200, { pose: { yaw: 10, pitch: 0, roll: 0 } });
    const f = swapFeasibility(b, a);
    expect(f.eyes.ok).toBe(false);
    expect(f.eyes.reason).toMatch(/turned/);
    expect(f.face.ok).toBe(true);
    const c = mkFace('f1', 0, 100, 200, { pose: { yaw: 20, pitch: 0, roll: 0 } });
    expect(swapFeasibility(c, a).face.ok).toBe(false);
  });
  it('only allows face mode when the base face is missing', () => {
    const src = mkFace('f1', 0, 100, 200);
    const f = swapFeasibility(src, undefined);
    expect(f.eyes.ok).toBe(false);
    expect(f.face.ok).toBe(true);
  });
});
