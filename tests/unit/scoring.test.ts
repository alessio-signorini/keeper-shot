import { describe, expect, it } from 'vitest';
import { normalizeSharpness, scoreFace } from '../../src/core/scoring';

describe('scoring', () => {
  it('penalizes blinks hard', () => {
    const open = scoreFace({ mouthSmileLeft: 0.5, mouthSmileRight: 0.5 }, { yaw: 0, pitch: 0 }, 1);
    const blink = scoreFace(
      { eyeBlinkLeft: 0.9, eyeBlinkRight: 0.9, mouthSmileLeft: 0.5, mouthSmileRight: 0.5 },
      { yaw: 0, pitch: 0 },
      1,
    );
    expect(blink.total).toBeLessThan(open.total * 0.35);
  });
  it("flags a blink relative to the person's own most-open eyes", () => {
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
