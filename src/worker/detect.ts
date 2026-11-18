import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import * as C from '../config';
import { boxOf, iou } from '../core/geometry';
import { poseFromMatrix } from '../core/pose';
import { implausibleGaze } from '../core/faceFilters';
import { tilePlan } from '../core/tiles';
import type { Box, Pt } from '../types';

export interface RawFace {
  landmarks: Pt[]; // work-resolution pixel coords
  blend: Record<string, number>;
  pose: { yaw: number; pitch: number; roll: number };
  box: Box;
}

// `scanner` only finds faces across hundreds of tiles; blendshapes and head pose are expensive per face, so only
// `landmarker` computes them, once per face, on the full-resolution crop (see refineFace).
let landmarker: FaceLandmarker | null = null;
let mode: 'scan' | 'full' | null = null;

// One model instance (a second one costs ~100MB of WASM heap); options are switched between scanning and refining.
async function setMode(m: 'scan' | 'full'): Promise<void> {
  if (mode === m) return;
  const full = m === 'full';
  await landmarker!.setOptions({
    outputFaceBlendshapes: full,
    outputFacialTransformationMatrixes: full,
    minFaceDetectionConfidence: full ? C.MIN_FACE_CONFIDENCE : C.SCAN_CONFIDENCE,
    minFacePresenceConfidence: full ? C.REFINE_PRESENCE : 0.5,
  });
  mode = m;
}

export async function initDetector(baseUrl: string): Promise<void> {
  if (landmarker) return;
  const fileset = await FilesetResolver.forVisionTasks(new URL('mediapipe-wasm', baseUrl).href);
  landmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: new URL('models/face_landmarker.task', baseUrl).href, delegate: C.DETECT_DELEGATE },
    runningMode: 'IMAGE',
    numFaces: C.MAX_FACES,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
    minFaceDetectionConfidence: C.SCAN_CONFIDENCE,
  });
  mode = 'scan';
}

/** Free the model and its WASM heap once detection is done (OpenCV needs the memory next). */
export function closeDetector(): void {
  landmarker?.close();
  landmarker = null;
  mode = null;
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

const same = (a: Box, b: Box) => {
  const ca = [a.x + a.w / 2, a.y + a.h / 2],
    cb = [b.x + b.w / 2, b.y + b.h / 2];
  const inside = (c: number[], r: Box) => c[0] > r.x && c[0] < r.x + r.w && c[1] > r.y && c[1] < r.y + r.h;
  return iou(a, b) > C.TILE_MERGE_IOU || inside(ca, b) || inside(cb, a);
};

/**
 * Detect faces in a working-resolution canvas. MediaPipe's detector downsizes its input to ~128px and only finds
 * faces covering ~1/6 of it, so the frame is scanned with overlapping tiles at several scales (see core/tiles).
 * `region` limits the fine scales to where the group was found in the previous frame.
 */
export async function detectFaces(canvas: OffscreenCanvas, region?: Box): Promise<RawFace[]> {
  const w = canvas.width,
    h = canvas.height;
  const out: RawFace[] = [];
  const add = (fs: RawFace[]) => {
    for (const f of fs) if (!out.some((m) => same(m.box, f.box))) out.push(f);
  };

  await setMode('scan');
  const whole = await createImageBitmap(canvas);
  try {
    add(run(whole, 0, 0, w, h));
  } finally {
    whole.close();
  }

  const edge = 3;
  for (const t of tilePlan(w, h, region)) {
    const tile = await createImageBitmap(canvas, t.x, t.y, t.w, t.h);
    try {
      // faces cut by an interior tile edge are partial; an overlapping tile sees them whole
      add(
        run(tile, t.x, t.y, t.w, t.h).filter(
          (f) =>
            (t.x === 0 || f.box.x > t.x + edge) &&
            (t.x + t.w >= w || f.box.x + f.box.w < t.x + t.w - edge) &&
            (t.y === 0 || f.box.y > t.y + edge) &&
            (t.y + t.h >= h || f.box.y + f.box.h < t.y + t.h - edge),
        ),
      );
    } finally {
      tile.close();
    }
  }
  return out;
}

async function detectInCrop(src: ImageBitmap, box: Box, context: number, full: boolean): Promise<RawFace | null> {
  const side = Math.min(Math.max(box.w, box.h) * context, src.width, src.height);
  const cx = box.x + box.w / 2,
    cy = box.y + box.h / 2;
  const sx = Math.round(Math.min(Math.max(0, cx - side / 2), src.width - side));
  const sy = Math.round(Math.min(Math.max(0, cy - side / 2), src.height - side));
  const sw = Math.round(side),
    sh = Math.round(side);
  const out = Math.max(C.REFINE_MIN_PX, Math.min(sw, C.REFINE_PX));
  await setMode(full ? 'full' : 'scan');
  const crop = await createImageBitmap(src, sx, sy, sw, sh, {
    resizeWidth: out,
    resizeHeight: out,
    resizeQuality: 'high',
  });
  let found: RawFace[];
  try {
    found = run(crop, sx, sy, sw, sh, 0);
  } finally {
    crop.close();
  }
  let best: RawFace | null = null,
    bestIou = C.REFINE_MIN_IOU;
  for (const f of found) {
    const v = iou(f.box, box);
    if (v >= bestIou) {
      best = f;
      bestIou = v;
    }
  }
  return best;
}

/**
 * Re-run the landmarker on a full-resolution crop around a candidate (full-res box). Verifies the candidate is a
 * real face (most tile hits on hands or props vanish) and yields landmarks/blendshapes from far more pixels.
 */
export async function refineFace(src: ImageBitmap, box: Box): Promise<RawFace | null> {
  const face = await detectInCrop(src, box, C.REFINE_CONTEXT, true);
  return face && !implausibleGaze(face.blend) ? face : null;
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
  const pad = 0.25;
  const x = Math.max(0, box.x - box.w * pad),
    y = Math.max(0, box.y - box.h * pad);
  const w = Math.min(canvas.width - x, box.w * (1 + 2 * pad)),
    h = Math.min(canvas.height - y, box.h * (1 + 2 * pad));
  const s = C.THUMB_PX / Math.max(w, h);
  const c = new OffscreenCanvas(Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s)));
  c.getContext('2d')!.drawImage(canvas, x, y, w, h, 0, 0, c.width, c.height);
  return c.convertToBlob({ type: 'image/jpeg', quality: C.THUMB_QUALITY });
}
