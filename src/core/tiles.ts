import * as C from '../config';
import type { Box } from '../types';

export interface Tile { x: number; y: number; w: number; h: number }

/**
 * Tile sizes for face search, coarse to fine. MediaPipe's face detector only finds faces that cover roughly
 * 1/6 of its input, so each scale targets a band of face sizes; the finest scale is set by the smallest face we
 * want (a fraction of the frame's long edge, so it works the same at any resolution).
 */
export function tileSizes(w: number, h: number): number[] {
  const long = Math.max(w, h), short = Math.min(w, h);
  const minFace = Math.max(C.MIN_FACE_PX, long * C.MIN_FACE_FRAC);
  const finest = Math.round(minFace * C.TILE_PER_FACE);
  const sizes: number[] = [];
  for (let s = Math.min(short, Math.round(long * C.TILE_COARSEST_FRAC)); s > finest; s = Math.round(s * C.TILE_STEP)) sizes.push(s);
  sizes.push(Math.min(short, finest));
  return [...new Set(sizes)];
}

function starts(from: number, to: number, tile: number): number[] {
  const len = to - from;
  if (len <= tile) return [from];
  const step = Math.max(1, Math.round(tile * (1 - C.TILE_OVERLAP)));
  const n = Math.ceil((len - tile) / step) + 1;
  return Array.from({ length: n }, (_, i) => Math.round(from + (i * (len - tile)) / (n - 1)));
}

/**
 * Overlapping tiles covering `region` (default: the whole frame) at every scale. Scales finer than
 * `TILE_REGION_BELOW` × long edge are limited to `region`, which keeps later frames of a burst fast.
 */
export function tilePlan(w: number, h: number, region?: Box): Tile[] {
  const tiles: Tile[] = [];
  const long = Math.max(w, h);
  for (const size of tileSizes(w, h)) {
    const r = region && size < long * C.TILE_REGION_BELOW ? region : { x: 0, y: 0, w, h };
    const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y));
    const x1 = Math.min(w, Math.ceil(r.x + r.w)), y1 = Math.min(h, Math.ceil(r.y + r.h));
    const tw = Math.min(size, w), th = Math.min(size, h);
    // keep tiles inside the frame even when the region is narrower than a tile
    const fx = Math.max(0, Math.min(x0, w - tw)), fy = Math.max(0, Math.min(y0, h - th));
    for (const y of starts(fy, Math.max(y1, fy + th), th)) for (const x of starts(fx, Math.max(x1, fx + tw), tw)) tiles.push({ x, y, w: tw, h: th });
  }
  return tiles;
}

/** Bounding box of faces, grown by `TILE_REGION_MARGIN` × the frame's long edge on each side. */
export function searchRegion(boxes: Box[], w: number, h: number): Box | undefined {
  if (boxes.length < C.TILE_REGION_MIN_FACES) return undefined;
  const m = Math.max(w, h) * C.TILE_REGION_MARGIN;
  const x0 = Math.max(0, Math.min(...boxes.map((b) => b.x)) - m), y0 = Math.max(0, Math.min(...boxes.map((b) => b.y)) - m);
  const x1 = Math.min(w, Math.max(...boxes.map((b) => b.x + b.w)) + m), y1 = Math.min(h, Math.max(...boxes.map((b) => b.y + b.h)) + m);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
