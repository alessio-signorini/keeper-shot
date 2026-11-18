import * as C from '../../config';
import type { Box } from '../../types';

/** Margin around the face box in face thumbnails, × box size. */
const THUMB_PAD = 0.25;

/** Variance of the 4-neighbour Laplacian on a grayscale crop resized to SHARPNESS_CROP_PX wide. */
export function sharpnessOf(canvas: OffscreenCanvas | ImageBitmap, box: Box): number {
  const sw = C.SHARPNESS_CROP_PX;
  const sh = Math.max(8, Math.round((box.h / Math.max(box.w, 1)) * sw));
  const c = new OffscreenCanvas(sw, sh);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(canvas, box.x, box.y, box.w, box.h, 0, 0, sw, sh);
  const d = ctx.getImageData(0, 0, sw, sh).data;
  const g = new Float32Array(sw * sh);
  for (let i = 0; i < g.length; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  let sum = 0,
    sum2 = 0,
    n = 0;
  for (let y = 1; y < sh - 1; y++) {
    for (let x = 1; x < sw - 1; x++) {
      const i = y * sw + x;
      const l = g[i - 1] + g[i + 1] + g[i - sw] + g[i + sw] - 4 * g[i];
      sum += l;
      sum2 += l * l;
      n++;
    }
  }
  const mean = sum / n;
  return sum2 / n - mean * mean;
}

export async function faceThumb(canvas: OffscreenCanvas | ImageBitmap, box: Box): Promise<Blob> {
  const x = Math.max(0, box.x - box.w * THUMB_PAD),
    y = Math.max(0, box.y - box.h * THUMB_PAD);
  const w = Math.min(canvas.width - x, box.w * (1 + 2 * THUMB_PAD)),
    h = Math.min(canvas.height - y, box.h * (1 + 2 * THUMB_PAD));
  const s = C.THUMB_PX / Math.max(w, h);
  const c = new OffscreenCanvas(Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s)));
  c.getContext('2d')!.drawImage(canvas, x, y, w, h, 0, 0, c.width, c.height);
  return c.convertToBlob({ type: 'image/jpeg', quality: C.THUMB_QUALITY });
}
