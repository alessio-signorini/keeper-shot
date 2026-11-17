import * as C from '../config';
import { applyAll, boxOf, fitSimilarity, invert, compose } from '../core/geometry';
import type { Box, Face, Frame, Mat3, Pick, Pt, Session } from '../types';
import { Tracker, withMats, type CV } from './cv';

export const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
const BROWS = [70, 63, 105, 66, 107, 336, 296, 334, 293, 300];
const EYE_SETS = [
  { contour: [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246], brow: [70, 63, 105, 66, 107, 55, 65, 52, 53, 46], lower: [33, 7, 163, 144, 145, 153, 154, 155, 133] },
  { contour: [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466], brow: [300, 293, 334, 296, 336, 285, 295, 282, 283, 276], lower: [263, 249, 390, 373, 374, 380, 381, 382, 362] },
];
const RIGID = [33, 133, 362, 263, 6, 168, 10, 338, 297, 332, 284, 251, 21, 54, 103, 67, 109, 162, 389];

export function convexHull(points: Pt[]): Pt[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function around(pts: Pt[], factor: number): Pt[] {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return pts.map((p) => [cx + (p[0] - cx) * factor, cy + (p[1] - cy) * factor]);
}

/** Mask polygons (in the landmarks' coordinate space) for a face swap or per-eye swap. */
export function maskPolygons(L: Pt[], mode: 'face' | 'eyes'): { poly: Pt[]; feather: number }[] {
  if (mode === 'face') {
    const oval = FACE_OVAL.map((i) => L[i]);
    const box = boxOf(oval);
    const brow = boxOf(BROWS.map((i) => L[i]));
    const cy = box.y + box.h / 2;
    const pts = oval.map((p): Pt => {
      if (p[1] < brow.y) return [p[0], p[1] - (cy - p[1]) * C.FACE_FOREHEAD_RAISE * 0.3]; // reach a bit further into the forehead
      if (p[1] > cy + box.h * 0.25) {
        // pull the jawline in toward the face centre to avoid chin/neck seams
        const cx = box.x + box.w / 2;
        const dx = cx - p[0], dy = cy - p[1];
        const d = Math.hypot(dx, dy) || 1;
        return [p[0] + (dx / d) * C.FACE_JAW_ERODE * box.w, p[1] + (dy / d) * C.FACE_JAW_ERODE * box.w];
      }
      return p;
    });
    pts.push(...BROWS.map((i) => L[i]));
    return [{ poly: convexHull(pts), feather: box.w * C.FACE_FEATHER }];
  }
  return EYE_SETS.map((e) => {
    const eye = boxOf(e.contour.map((i) => L[i]));
    const down = eye.w * 0.5;
    const pts = [...e.contour.map((i) => L[i]), ...e.brow.map((i) => L[i]), ...e.lower.map((i): Pt => [L[i][0], L[i][1] + down])];
    const hull = convexHull(pts);
    const hb = boxOf(hull);
    return { poly: around(hull, 1 + (2 * C.EYES_DILATE * eye.w) / Math.max(hb.w, 1)), feather: eye.w * C.EYES_FEATHER };
  });
}

export type FrameSource = (frameId: string) => Promise<ImageBitmap>;

export interface RenderOpts {
  /** output pixels per full-res pixel */
  scale: number;
  /** returns a bitmap of the frame already at `scale` */
  source: FrameSource;
  /** called when a source bitmap is no longer needed */
  release?: (frameId: string, bmp: ImageBitmap) => void;
  base: ImageBitmap;
  /** called once the base bitmap has been copied into the output canvas */
  releaseBase?: () => void;
  cv: CV;
}

/** Source→base transform (full-res coords) refined by a similarity fit on rigid landmarks. */
export function sourceToBase(session: Session, src: Face, baseFace: Face | undefined, base: Frame): Mat3 {
  const srcFrame = session.frames.find((f) => f.id === src.frameId)!;
  const global = compose(invert(base.toRef), srcFrame.toRef);
  if (!baseFace) return global;
  const fit = fitSimilarity(RIGID.map((i) => src.landmarks[i]), RIGID.map((i) => baseFace.landmarks[i]));
  return isFinite(fit.rms) ? fit.m : global;
}

interface Plan { Ts: Mat3; mapped: Pt[]; roi: Box }

/** Where a pick lands in the (scaled) base canvas. */
export function planPick(session: Session, pick: Pick, scale: number, W: number, H: number): Plan {
  const base = session.frames.find((f) => f.id === session.baseFrameId)!;
  const src = session.faces[pick.faceId];
  const person = session.people.find((p) => p.id === pick.personId)!;
  const baseFaceId = person.faces[base.id];
  const T = sourceToBase(session, src, baseFaceId ? session.faces[baseFaceId] : undefined, base);
  const S: Mat3 = [scale, 0, 0, 0, scale, 0, 0, 0, 1];
  const Ts = compose(S, compose(T, invert(S))); // scaled coords → scaled coords
  const mapped = applyAll(compose(S, T), src.landmarks);
  return { Ts, mapped, roi: expand(boxOf(mapped), C.ROI_SCALE, W, H) };
}

const hits = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const key = (p: Pick) => `${p.faceId}:${p.mode}`;

/**
 * Holds a composite canvas and applies pick changes incrementally: only the regions touched by changed
 * picks (plus any overlapping picks) are restored from the base and re-blended.
 */
export class Compositor {
  readonly canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;
  private baseCopy: OffscreenCanvas | null = null;
  private applied = new Map<string, { key: string; roi: Box }>();

  constructor(readonly baseId: string, readonly scale: number, base: ImageBitmap, restorable: boolean) {
    this.canvas = new OffscreenCanvas(base.width, base.height);
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
    this.ctx.drawImage(base, 0, 0);
    if (restorable) {
      this.baseCopy = new OffscreenCanvas(base.width, base.height);
      this.baseCopy.getContext('2d')!.drawImage(base, 0, 0);
    }
  }

  async update(session: Session, picks: Record<string, Pick>, opts: { cv: CV | null; source: FrameSource; release?: (id: string, b: ImageBitmap) => void }) {
    const W = this.canvas.width, H = this.canvas.height;
    const order = new Map(session.people.map((p, i) => [p.id, i]));
    const want = new Map<string, { pick: Pick; plan: Plan }>();
    for (const p of Object.values(picks)) {
      if (p.mode !== 'base') want.set(p.personId, { pick: p, plan: planPick(session, p, this.scale, W, H) });
    }

    const dirty: Box[] = [];
    const redo = new Set<string>();
    for (const [id, a] of this.applied) {
      if (want.get(id) && key(want.get(id)!.pick) === a.key) continue;
      dirty.push(a.roi);
    }
    for (const [id, w] of want) {
      if (this.applied.get(id)?.key !== key(w.pick)) { dirty.push(w.plan.roi); redo.add(id); }
    }
    // pull in unchanged picks that overlap a dirty region, until stable
    for (let grew = true; grew;) {
      grew = false;
      for (const [id, w] of want) {
        if (redo.has(id) || !dirty.some((d) => hits(d, w.plan.roi))) continue;
        redo.add(id);
        dirty.push(w.plan.roi);
        grew = true;
      }
    }

    if (this.baseCopy) {
      for (const r of dirty) this.ctx.drawImage(this.baseCopy, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
    }
    for (const id of [...this.applied.keys()]) if (!want.has(id) || redo.has(id)) this.applied.delete(id);

    const byFrame = new Map<string, string[]>();
    for (const id of [...redo].sort((x, y) => order.get(x)! - order.get(y)!)) {
      const fid = session.faces[want.get(id)!.pick.faceId].frameId;
      byFrame.set(fid, [...(byFrame.get(fid) ?? []), id]);
    }
    for (const [frameId, ids] of byFrame) {
      const bmp = await opts.source(frameId);
      try {
        for (const id of ids) {
          const { pick, plan } = want.get(id)!;
          await swapOne(opts.cv!, this.ctx, bmp, plan, pick.mode as 'face' | 'eyes');
          this.applied.set(id, { key: key(pick), roi: plan.roi });
        }
      } finally {
        opts.release?.(frameId, bmp);
      }
    }
  }
}

export async function renderComposite(session: Session, picks: Record<string, Pick>, opts: RenderOpts): Promise<OffscreenCanvas> {
  const comp = new Compositor(session.baseFrameId, opts.scale, opts.base, false);
  opts.releaseBase?.();
  await comp.update(session, picks, opts);
  return comp.canvas;
}

function expand(b: Box, k: number, W: number, H: number): Box {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2, w = b.w * k, h = b.h * k;
  const x0 = Math.max(0, Math.floor(cx - w / 2)), y0 = Math.max(0, Math.floor(cy - h / 2));
  const x1 = Math.min(W, Math.ceil(cx + w / 2)), y1 = Math.min(H, Math.ceil(cy + h / 2));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const LANCZOS_MARGIN = 4;

/** Lanczos warp of only the source region the ROI needs; alpha marks where the source covers the ROI. */
function warpPatch(cv: CV, srcBmp: ImageBitmap, Ts: Mat3, roi: Box): ImageData {
  const inv = invert(Ts);
  const corners = applyAll(inv, [[roi.x, roi.y], [roi.x + roi.w, roi.y], [roi.x, roi.y + roi.h], [roi.x + roi.w, roi.y + roi.h]]);
  const bb = boxOf(corners);
  const sx = Math.max(0, Math.floor(bb.x) - LANCZOS_MARGIN), sy = Math.max(0, Math.floor(bb.y) - LANCZOS_MARGIN);
  const sw = Math.min(srcBmp.width, Math.ceil(bb.x + bb.w) + LANCZOS_MARGIN) - sx;
  const sh = Math.min(srcBmp.height, Math.ceil(bb.y + bb.h) + LANCZOS_MARGIN) - sy;
  if (sw < 2 || sh < 2) return new ImageData(roi.w, roi.h);
  const crop = new OffscreenCanvas(sw, sh);
  const cctx = crop.getContext('2d', { willReadFrequently: true })!;
  cctx.drawImage(srcBmp, sx, sy, sw, sh, 0, 0, sw, sh);
  const img = cctx.getImageData(0, 0, sw, sh);
  return withMatsSync((t) => {
    const src = t.add(cv.matFromImageData(img));
    const dst = t.add(new cv.Mat());
    // crop coords → ROI coords
    const M = t.add(cv.matFromArray(2, 3, cv.CV_64F, [
      Ts[0], Ts[1], Ts[0] * sx + Ts[1] * sy + Ts[2] - roi.x,
      Ts[3], Ts[4], Ts[3] * sx + Ts[4] * sy + Ts[5] - roi.y,
    ]));
    cv.warpAffine(src, dst, M, new cv.Size(roi.w, roi.h), cv.INTER_LANCZOS4, cv.BORDER_CONSTANT, new cv.Scalar(0, 0, 0, 0));
    return new ImageData(new Uint8ClampedArray(dst.data), roi.w, roi.h);
  });
}

function withMatsSync<T>(fn: (t: Tracker) => T): T {
  const t = new Tracker();
  try { return fn(t); } finally { t.dispose(); }
}

async function swapOne(cv: CV, ctx: OffscreenCanvasRenderingContext2D, srcBmp: ImageBitmap, plan: Plan, mode: 'face' | 'eyes') {
  const { Ts, mapped: srcLm, roi } = plan;
  const polys = maskPolygons(srcLm, mode);
  if (roi.w < 8 || roi.h < 8) return;

  const patchData = warpPatch(cv, srcBmp, Ts, roi);

  // hard mask polygons (white on black), later feathered with a Gaussian blur
  const mc = new OffscreenCanvas(roi.w, roi.h);
  const mctx = mc.getContext('2d', { willReadFrequently: true })!;
  mctx.fillStyle = '#000';
  mctx.fillRect(0, 0, roi.w, roi.h);
  mctx.fillStyle = '#fff';
  for (const { poly } of polys) {
    mctx.beginPath();
    poly.forEach((p, i) => (i ? mctx.lineTo(p[0] - roi.x, p[1] - roi.y) : mctx.moveTo(p[0] - roi.x, p[1] - roi.y)));
    mctx.closePath();
    mctx.fill();
  }
  const maskData = mctx.getImageData(0, 0, roi.w, roi.h);
  const baseData = ctx.getImageData(roi.x, roi.y, roi.w, roi.h);
  const feather = Math.max(...polys.map((p) => p.feather));

  const out = await withMats((t) => blendRoi(cv, t, baseData, patchData, maskData, feather));
  ctx.putImageData(out, roi.x, roi.y);
}

function odd(n: number): number {
  const k = Math.max(3, Math.round(n));
  return k % 2 ? k : k + 1;
}

function blendRoi(cv: CV, t: Tracker, baseData: ImageData, patchData: ImageData, maskData: ImageData, feather: number): ImageData {
  const w = baseData.width, h = baseData.height;
  const baseRGB = t.add(new cv.Mat()), patchRGB = t.add(new cv.Mat());
  cv.cvtColor(t.add(cv.matFromImageData(baseData)), baseRGB, cv.COLOR_RGBA2RGB);
  const patchRGBA = t.add(cv.matFromImageData(patchData));
  cv.cvtColor(patchRGBA, patchRGB, cv.COLOR_RGBA2RGB);

  // mask 0..1 float: polygon ∧ patch alpha, feathered
  const mask8 = t.add(new cv.Mat());
  cv.cvtColor(t.add(cv.matFromImageData(maskData)), mask8, cv.COLOR_RGBA2GRAY);
  const alpha = t.add(new cv.Mat());
  const chans = t.add(new cv.MatVector());
  cv.split(patchRGBA, chans);
  t.add(chans.get(3)).copyTo(alpha);
  // only trust pixels where the source actually covers the ROI
  cv.threshold(alpha, alpha, 250, 255, cv.THRESH_BINARY);
  cv.min(mask8, alpha, mask8);
  const maskF = t.add(new cv.Mat());
  const k = odd(feather);
  cv.GaussianBlur(mask8, maskF, new cv.Size(k, k), feather / 2, feather / 2, cv.BORDER_DEFAULT);
  maskF.convertTo(maskF, cv.CV_32F, 1 / 255);

  // colour match in Lab over a ring just inside the mask edge
  const inner = t.add(new cv.Mat());
  cv.threshold(mask8, inner, 127, 255, cv.THRESH_BINARY);
  const eroded = t.add(new cv.Mat());
  const ek = odd(feather);
  const kernel = t.add(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(ek, ek)));
  cv.erode(inner, eroded, kernel);
  const ring = t.add(new cv.Mat());
  cv.subtract(inner, eroded, ring);
  if (cv.countNonZero(ring) > 30) matchColors(cv, t, baseRGB, patchRGB, ring);

  const out = laplacianBlend(cv, t, baseRGB, patchRGB, maskF);
  const rgba = t.add(new cv.Mat());
  cv.cvtColor(out, rgba, cv.COLOR_RGB2RGBA);
  return new ImageData(new Uint8ClampedArray(rgba.data), w, h);
}

function matchColors(cv: CV, t: Tracker, base: CV, patch: CV, ring: CV) {
  const labB = t.add(new cv.Mat()), labP = t.add(new cv.Mat());
  cv.cvtColor(base, labB, cv.COLOR_RGB2Lab);
  cv.cvtColor(patch, labP, cv.COLOR_RGB2Lab);
  const mb = t.add(new cv.Mat()), sb = t.add(new cv.Mat()), mp = t.add(new cv.Mat()), sp = t.add(new cv.Mat());
  cv.meanStdDev(labB, mb, sb, ring);
  cv.meanStdDev(labP, mp, sp, ring);
  const planes = t.add(new cv.MatVector());
  cv.split(labP, planes);
  for (let c = 0; c < 3; c++) {
    const gain = Math.min(2, Math.max(0.5, sb.data64F[c] / Math.max(sp.data64F[c], 1e-3)));
    const beta = mb.data64F[c] - mp.data64F[c] * gain;
    const ch = t.add(planes.get(c));
    const adj = t.add(new cv.Mat());
    ch.convertTo(adj, cv.CV_8U, gain, beta);
    planes.set(c, adj);
  }
  cv.merge(planes, labP);
  cv.cvtColor(labP, patch, cv.COLOR_Lab2RGB);
}

function laplacianBlend(cv: CV, t: Tracker, a8: CV, b8: CV, mask: CV): CV {
  const levels = Math.max(1, Math.min(C.PYRAMID_LEVELS, Math.floor(Math.log2(Math.min(a8.cols, a8.rows))) - 2));
  const a = t.add(new cv.Mat()), b = t.add(new cv.Mat());
  a8.convertTo(a, cv.CV_32FC3);
  b8.convertTo(b, cv.CV_32FC3);
  const m3 = t.add(new cv.Mat());
  const mv = t.add(new cv.MatVector());
  mv.push_back(mask); mv.push_back(mask); mv.push_back(mask);
  cv.merge(mv, m3);

  const gauss = (src: CV): CV[] => {
    const g = [src];
    for (let i = 0; i < levels; i++) {
      const d = t.add(new cv.Mat());
      cv.pyrDown(g[i], d);
      g.push(d);
    }
    return g;
  };
  const lap = (g: CV[]): CV[] => {
    const l: CV[] = [];
    for (let i = 0; i < levels; i++) {
      const up = t.add(new cv.Mat());
      cv.pyrUp(g[i + 1], up, new cv.Size(g[i].cols, g[i].rows));
      const d = t.add(new cv.Mat());
      cv.subtract(g[i], up, d);
      l.push(d);
    }
    l.push(g[levels]);
    return l;
  };
  const la = lap(gauss(a)), lb = lap(gauss(b)), gm = gauss(m3);
  const blended: CV[] = la.map((_, i) => {
    const inv = t.add(new cv.Mat());
    const ones = t.add(new cv.Mat(gm[i].rows, gm[i].cols, gm[i].type(), new cv.Scalar(1, 1, 1)));
    cv.subtract(ones, gm[i], inv);
    const x = t.add(new cv.Mat()), y = t.add(new cv.Mat()), r = t.add(new cv.Mat());
    cv.multiply(la[i], inv, x);
    cv.multiply(lb[i], gm[i], y);
    cv.add(x, y, r);
    return r;
  });
  let cur = blended[levels];
  for (let i = levels - 1; i >= 0; i--) {
    const up = t.add(new cv.Mat());
    cv.pyrUp(cur, up, new cv.Size(blended[i].cols, blended[i].rows));
    const sum = t.add(new cv.Mat());
    cv.add(up, blended[i], sum);
    cur = sum;
  }
  const out = t.add(new cv.Mat());
  cur.convertTo(out, cv.CV_8UC3);
  return out;
}
