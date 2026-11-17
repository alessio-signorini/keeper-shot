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

function run(image: ImageBitmap, offX: number, offY: number, w: number, h: number): RawFace[] {
  const res = landmarker!.detect(image);
  const out: RawFace[] = [];
  res.faceLandmarks.forEach((lm, i) => {
    const landmarks = lm.map((p): Pt => [p.x * w + offX, p.y * h + offY]);
    const blend: Record<string, number> = {};
    for (const c of res.faceBlendshapes?.[i]?.categories ?? []) blend[c.categoryName] = c.score;
    const mat = res.facialTransformationMatrixes?.[i]?.data;
    const pose = mat ? poseFromMatrix(mat) : { yaw: 0, pitch: 0, roll: 0 };
    const box = boxOf(landmarks);
    if (box.w >= C.MIN_FACE_PX) out.push({ landmarks, blend, pose, box });
  });
  return out;
}

/** Detect faces in a working-resolution canvas; retries on overlapping tiles if nothing is found. */
export async function detectFaces(canvas: OffscreenCanvas): Promise<RawFace[]> {
  const w = canvas.width, h = canvas.height;
  const whole = await createImageBitmap(canvas);
  let faces: RawFace[];
  try {
    faces = run(whole, 0, 0, w, h);
  } finally {
    whole.close();
  }
  if (faces.length || Math.max(w, h) < C.BIG_IMAGE_PX) return faces;

  const n = C.TILE_GRID;
  const tw = Math.round(w / (n - (n - 1) * C.TILE_OVERLAP) ), th = Math.round(h / (n - (n - 1) * C.TILE_OVERLAP));
  const merged: RawFace[] = [];
  for (let ty = 0; ty < n; ty++) {
    for (let tx = 0; tx < n; tx++) {
      const x = Math.round(n > 1 ? (tx * (w - tw)) / (n - 1) : 0);
      const y = Math.round(n > 1 ? (ty * (h - th)) / (n - 1) : 0);
      const tile = await createImageBitmap(canvas, x, y, tw, th);
      try {
        for (const f of run(tile, x, y, tw, th)) {
          if (!merged.some((m) => iou(m.box, f.box) > C.TILE_MERGE_IOU)) merged.push(f);
        }
      } finally {
        tile.close();
      }
    }
  }
  return merged;
}

/** Variance of the 4-neighbour Laplacian on a grayscale crop resized to SHARPNESS_CROP_PX wide. */
export function sharpnessOf(canvas: OffscreenCanvas, box: Box): number {
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

export async function faceThumb(canvas: OffscreenCanvas, box: Box): Promise<Blob> {
  const pad = 0.25;
  const x = Math.max(0, box.x - box.w * pad), y = Math.max(0, box.y - box.h * pad);
  const w = Math.min(canvas.width - x, box.w * (1 + 2 * pad)), h = Math.min(canvas.height - y, box.h * (1 + 2 * pad));
  const s = C.THUMB_PX / Math.max(w, h);
  const c = new OffscreenCanvas(Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s)));
  c.getContext('2d')!.drawImage(canvas, x, y, w, h, 0, 0, c.width, c.height);
  return c.convertToBlob({ type: 'image/jpeg', quality: C.THUMB_QUALITY });
}
