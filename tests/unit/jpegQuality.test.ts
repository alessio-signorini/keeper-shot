import { describe, expect, it } from 'vitest';
import { estimateJpegQuality, estimateQualityFromTable } from '../../src/core/jpegQuality';

describe('jpegQuality', () => {
  it('recovers quality 50 from the standard table (clamped)', () => {
    const zz = [
      16, 11, 12, 14, 12, 10, 16, 14, 13, 14, 18, 17, 16, 19, 24, 40, 26, 24, 22, 22, 24, 49, 35, 37, 29, 40, 58, 51,
      61, 60, 57, 51, 56, 55, 64, 72, 92, 78, 64, 68, 87, 69, 55, 56, 80, 109, 81, 87, 95, 98, 103, 104, 103, 62, 77,
      113, 121, 112, 100, 120, 92, 101, 103, 99,
    ];
    expect(estimateQualityFromTable(zz)).toBe(0.85);
  });
  it('maps an all-ones table to the max', () => {
    expect(estimateQualityFromTable(new Array(64).fill(1))).toBe(0.97);
  });
  it('falls back without DQT', () => {
    expect(estimateJpegQuality(new Uint8Array([0xff, 0xd8, 0xff, 0xd9, 0, 0, 0, 0]))).toBe(0.92);
  });
});
