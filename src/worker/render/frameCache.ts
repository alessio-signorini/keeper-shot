import { getBlob } from '../../storage';
import type { Frame } from '../../types';
import { decodeBlob, scaledCanvas } from '../lib/decode';

/** Downscaled frames kept for the preview (LRU). */
const MAX_CACHED_FRAMES = 6;

export async function frameBlob(frame: Frame): Promise<Blob> {
  const b = await getBlob(frame.blobKey);
  if (!b) throw new Error(`Missing stored photo ${frame.name}`);
  return b;
}

/** Decode a stored frame at `scale` (≤ 1), orientation applied. */
export async function decodeFrame(frame: Frame, scale: number, baseUrl: string): Promise<ImageBitmap> {
  const blob = await frameBlob(frame);
  if (scale < 1) {
    // decoding straight to the target size avoids ever holding the 80MB full-resolution bitmap
    try {
      return await createImageBitmap(blob, {
        imageOrientation: 'from-image',
        resizeWidth: Math.round(frame.width * scale),
        resizeHeight: Math.round(frame.height * scale),
        resizeQuality: 'high',
      });
    } catch {
      /* e.g. HEIC: fall back to the full decode below */
    }
  }
  const full = await decodeBlob(blob, baseUrl);
  if (scale >= 1) return full;
  try {
    return await createImageBitmap(scaledCanvas(full, Math.round(full.width * scale), Math.round(full.height * scale)));
  } finally {
    full.close();
  }
}

/** LRU of decoded frames by (frame, scale). Returned bitmaps are owned by the cache: don't close them. */
export class FrameCache {
  private bitmaps = new Map<string, ImageBitmap>();

  constructor(private baseUrl: () => string) {}

  async get(frame: Frame, scale: number): Promise<ImageBitmap> {
    const key = `${frame.id}@${scale.toFixed(4)}`;
    const hit = this.bitmaps.get(key);
    if (hit) {
      this.bitmaps.delete(key);
      this.bitmaps.set(key, hit);
      return hit;
    }
    const b = await decodeFrame(frame, scale, this.baseUrl());
    this.bitmaps.set(key, b);
    while (this.bitmaps.size > MAX_CACHED_FRAMES) {
      const oldest = this.bitmaps.keys().next().value!;
      this.bitmaps.get(oldest)!.close();
      this.bitmaps.delete(oldest);
    }
    return b;
  }

  clear(): void {
    for (const b of this.bitmaps.values()) b.close();
    this.bitmaps.clear();
  }
}
