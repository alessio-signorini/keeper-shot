import { JPEG_QUALITY_FALLBACK, JPEG_QUALITY_MAX, JPEG_QUALITY_MIN } from '../config';

// IJG standard luminance table (quality 50 baseline)
const STD_LUMA = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51,
  87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101,
  72, 92, 95, 98, 112, 100, 103, 99,
];

/** Estimate IJG quality (0..1, clamped) from the luminance DQT table (zig-zag order, as stored in the file). */
export function estimateQualityFromTable(table: ArrayLike<number>): number {
  const ZZ = [
    0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21,
    28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54,
    47, 55, 62, 63,
  ];
  let sumT = 0,
    sumS = 0;
  for (let i = 0; i < 64; i++) {
    sumT += table[i];
    sumS += STD_LUMA[ZZ[i]];
  }
  // scale = sumT / sumS (percent, roughly); invert IJG formula
  const ratio = (sumT / sumS) * 100;
  const q = ratio <= 100 ? (200 - ratio) / 2 : 5000 / ratio;
  return Math.min(JPEG_QUALITY_MAX, Math.max(JPEG_QUALITY_MIN, q / 100));
}

/** Scan JPEG bytes for the first DQT (table 0, 8-bit) and estimate quality. */
export function estimateJpegQuality(bytes: Uint8Array): number {
  let i = 2;
  while (i + 4 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = bytes[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker === 0xda) break;
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker === 0xdb) {
      let p = i + 4;
      const end = i + 2 + len;
      while (p < end) {
        const pq = bytes[p] >> 4,
          id = bytes[p] & 15;
        p++;
        if (pq !== 0) {
          p += 128;
          continue;
        }
        if (id === 0) return estimateQualityFromTable(bytes.subarray(p, p + 64));
        p += 64;
      }
    }
    i += 2 + len;
  }
  return JPEG_QUALITY_FALLBACK;
}
