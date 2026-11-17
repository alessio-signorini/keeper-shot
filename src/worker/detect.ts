import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import * as C from '../config';
import { boxOf, iou } from '../core/geometry';
import { poseFromMatrix } from '../core/pose';
import type { Box, Pt } from '../types';

export interface RawFace {
  landmarks: Pt[]; // work-resolution pixel coords
  blend: Record<string, number>;
  pose: { yaw: number; pitch: number; roll: number };
  box: Box;
}

let landmarker: FaceLandmarker | null = null;

export async function initDetector(baseUrl: string): Promise<void> {
  if (landmarker) return;
  const fileset = await FilesetResolver.forVisionTasks(new URL('mediapipe-wasm', baseUrl).href);
  const make = (delegate: 'GPU' | 'CPU') =>
    FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: new URL('models/face_landmarker.task', baseUrl).href, delegate },
      runningMode: 'IMAGE',
      numFaces: C.MAX_FACES,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      minFaceDetectionConfidence: C.MIN_FACE_CONFIDENCE,
    });
  try {
    landmarker = await make('GPU');
  } catch {
    landmarker = await make('CPU');
  }
}

/** Free the model and its WASM heap once detection is done (OpenCV needs the memory next). */
export function closeDetector(): void {
  landmarker?.close();
  landmarker = null;
}

function run(image: ImageBitmap, offX: number, offY: number, w: number, h: number, minFace = C.MIN_FACE_PX): RawFace[] {
  const res = landmarker!.detect(image);
  const out: RawFace[] = [];
  res.faceLandmarks.forEach((lm, i) => {
    const landmarks = lm.map((p): Pt => [p.x * w + offX, p.y * h + offY]);
    const blend: Record<string, number> = {};
    for (const c of res.faceBlendshapes?.[i]?.categories ?? []) blend[c.categoryName] = c.score;
    const mat = res.facialTransformationMatrixes?.[i]?.data;
    const pose = mat ? poseFromMatrix(mat) : { yaw: 0, pitch: 0, roll: 0 };
    const box = boxOf(landmarks);
    if (box.w >= minFace) out.push({ landmarks, blend, pose, box });
  });
  return out;
}

function tileStarts(len: number, tile: number): number[] {
  if (len <= tile) return [0];
  const step = Math.max(1, Math.round(tile * (1 - C.TILE_OVERLAP)));
  const n = Math.ceil((len - tile) / step) + 1;
  return Array.from({ length: n }, (_, i) => Math.round((i * (len - tile)) / (n - 1)));
}

const same = (a: Box, b: Box) => {
  const ca = [a.x + a.w / 2, a.y + a.h / 2], cb = [b.x + b.w / 2, b.y + b.h / 2];
  const inside = (c: number[], r: Box) => c[0] > r.x && c[0] < r.x + r.w && c[1] > r.y && c[1] < r.y + r.h;
  return iou(a, b) > C.TILE_MERGE_IOU || inside(ca, b) || inside(cb, a);
};

/**
 * Detect faces in a working-resolution canvas. MediaPipe's detector internally downsizes its input to
 * ~128px, so group-photo faces vanish on the whole image; scanning overlapping tiles keeps them resolvable.
 */
export async function detectFaces(canvas: OffscreenCanvas): Promise<RawFace[]> {
  const w = canvas.width, h = canvas.height;
  const out: RawFace[] = [];
  const add = (fs: RawFace[]) => {
    for (const f of fs) if (!out.some((m) => same(m.box, f.box))) out.push(f);
  };

  const whole = await createImageBitmap(canvas);
  try {
    add(run(whole, 0, 0, w, h));
  } finally {
    whole.close();
  }
  if (Math.max(w, h) < C.BIG_IMAGE_PX) return out;

  for (const size of C.TILE_SIZES) {
    const tw = Math.min(w, size), th = Math.min(h, size);
    for (const ty of tileStarts(h, th)) {
      for (const tx of tileStarts(w, tw)) {
        const tile = await createImageBitmap(canvas, tx, ty, tw, th);
        try {
          // faces cut by an interior tile edge are partial; a neighbouring tile sees them whole
          const edge = 3;
          add(run(tile, tx, ty, tw, th).filter((f) =>
            (tx === 0 || f.box.x > tx + edge) && (tx + tw >= w || f.box.x + f.box.w < tx + tw - edge) &&
            (ty === 0 || f.box.y > ty + edge) && (ty + th >= h || f.box.y + f.box.h < ty + th - edge)));
        } finally {
          tile.close();
        }
      }
    }
  }
  return out;
}

/**
 * Re-run the landmarker on a full-resolution crop around a candidate (full-res box). Verifies the candidate is a
 * real face (tile hits on hands or props usually vanish) and yields landmarks/blendshapes from far more pixels.
 */
export async function refineFace(src: ImageBitmap, box: Box): Promise<RawFace | null> {
  const side = Math.min(Math.max(box.w, box.h) * C.REFINE_CONTEXT, src.width, src.height);
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const sx = Math.round(Math.min(Math.max(0, cx - side / 2), src.width - side));
  const sy = Math.round(Math.min(Math.max(0, cy - side / 2), src.height - side));
  const sw = Math.round(side), sh = Math.round(side);
  const out = Math.min(sw, C.REFINE_PX);
  const crop = await createImageBitmap(src, sx, sy, sw, sh, { resizeWidth: out, resizeHeight: out, resizeQuality: 'high' });
  let found: RawFace[];
  try {
    found = run(crop, sx, sy, sw, sh, 0);
  } finally {
    crop.close();
  }
  let best: RawFace | null = null, bestIou = C.REFINE_MIN_IOU;
  for (const f of found) {
    const v = iou(f.box, box);
    if (v >= bestIou) { best = f; bestIou = v; }
  }
  return best;
}

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
  let sum = 0, sum2 = 0, n = 0;
  for (let y = 1; y < sh - 1; y++) {
    for (let x = 1; x < sw - 1; x++) {
      const i = y * sw + x;
      const l = g[i - 1] + g[i + 1] + g[i - sw] + g[i + sw] - 4 * g[i];
      sum += l; sum2 += l * l; n++;
    }
  }
  const mean = sum / n;
  return sum2 / n - mean * mean;
}

export async function faceThumb(canvas: OffscreenCanvas | ImageBitmap, box: Box): Promise<Blob> {
  const pad = 0.25;
  const x = Math.max(0, box.x - box.w * pad), y = Math.max(0, box.y - box.h * pad);
  const w = Math.min(canvas.width - x, box.w * (1 + 2 * pad)), h = Math.min(canvas.height - y, box.h * (1 + 2 * pad));
  const s = C.THUMB_PX / Math.max(w, h);
  const c = new OffscreenCanvas(Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s)));
  c.getContext('2d')!.drawImage(canvas, x, y, w, h, 0, 0, c.width, c.height);
  return c.convertToBlob({ type: 'image/jpeg', quality: C.THUMB_QUALITY });
}
