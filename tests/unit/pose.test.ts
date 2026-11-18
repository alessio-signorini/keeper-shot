import { describe, expect, it } from 'vitest';
import { poseFromMatrix } from '../../src/core/pose';

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
