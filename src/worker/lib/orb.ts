import * as C from '../../config';
import { compose, IDENTITY, invert, scaleMat } from '../../core/geometry';
import { ransacSimilarity } from '../../core/ransac';
import type { Box, Mat3, Pt } from '../../types';
import { loadCV, withMats, type CV } from './opencv';

export interface AlignFeatures {
  w: number;
  h: number;
  gray: Uint8Array; // ALIGN_LONG_EDGE grayscale
  masks: Box[]; // face boxes to ignore, in align coords
}

export interface AlignResult {
  toRef: Mat3;
  inliers: number;
  fallback: boolean;
  identity: boolean;
  matches: [number, number, number, number][];
}

function sampleMatches(
  pairs: { a: Pt; b: Pt }[],
  inlier: (i: number) => boolean,
  s: number,
): [number, number, number, number][] {
  const idx = pairs.map((_, i) => i).filter(inlier);
  const step = Math.max(1, Math.ceil(idx.length / C.DEBUG_MAX_MATCHES));
  return idx
    .filter((_, k) => k % step === 0)
    .map((i) => [pairs[i].a[0] / s, pairs[i].a[1] / s, pairs[i].b[0] / s, pairs[i].b[1] / s]);
}

export function maskBoxes(boxes: Box[], scale: number): Box[] {
  return boxes.map((b) => {
    const w = b.w * scale * C.ALIGN_MASK_WIDE,
      cx = (b.x + b.w / 2) * scale;
    return { x: cx - w / 2, y: b.y * scale, w, h: b.h * scale * C.ALIGN_MASK_TALL };
  });
}

export function toGray(canvas: OffscreenCanvas): Uint8Array {
  const d = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height).data;
  const g = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0; i < g.length; i++) g[i] = (299 * d[i * 4] + 587 * d[i * 4 + 1] + 114 * d[i * 4 + 2]) / 1000;
  return g;
}

interface Feat {
  kp: Pt[];
  des: CV;
  kpv: CV;
}

function orbFeatures(cv: CV, f: AlignFeatures, t: { add: <T extends { delete: () => void }>(m: T) => T }): Feat {
  const gray = t.add(cv.matFromArray(f.h, f.w, cv.CV_8UC1, f.gray as unknown as number[]));
  const mask = t.add(new cv.Mat(f.h, f.w, cv.CV_8UC1, new cv.Scalar(255)));
  for (const b of f.masks) {
    cv.rectangle(
      mask,
      new cv.Point(Math.max(0, Math.round(b.x)), Math.max(0, Math.round(b.y))),
      new cv.Point(Math.min(f.w - 1, Math.round(b.x + b.w)), Math.min(f.h - 1, Math.round(b.y + b.h))),
      new cv.Scalar(0),
      -1,
    );
  }
  const orb = t.add(new cv.ORB(C.ORB_FEATURES));
  const kpv = new cv.KeyPointVector();
  const des = new cv.Mat();
  orb.detectAndCompute(gray, mask, kpv, des);
  const kp: Pt[] = [];
  for (let i = 0; i < kpv.size(); i++) {
    const p = kpv.get(i).pt;
    kp.push([p.x, p.y]);
  }
  return { kp, des, kpv };
}

/** Holds the reference frame's features and aligns other frames to it. */
export class BackgroundAligner {
  private cv!: CV;
  private ref!: Feat;

  static async create(baseUrl: string, ref: AlignFeatures): Promise<BackgroundAligner> {
    const a = new BackgroundAligner();
    a.cv = await loadCV(baseUrl);
    await withMats((t) => {
      const f = orbFeatures(a.cv, ref, t);
      a.ref = f; // owned beyond the tracker; freed in dispose()
    });
    return a;
  }

  dispose() {
    this.ref?.des.delete();
    this.ref?.kpv.delete();
  }

  async align(frame: AlignFeatures, fullW: number): Promise<AlignResult> {
    const cv = this.cv;
    const s = frame.w / fullW; // full → align scale
    const S = scaleMat(s);
    const Sinv = invert(S);
    return withMats((t) => {
      const feat = orbFeatures(cv, frame, t);
      t.add(feat.des);
      t.add(feat.kpv);
      const pairs: { a: Pt; b: Pt }[] = [];
      if (feat.kp.length >= 8 && this.ref.kp.length >= 8) {
        const matcher = t.add(new cv.BFMatcher(cv.NORM_HAMMING, false));
        const knn = t.add(new cv.DMatchVectorVector());
        matcher.knnMatch(feat.des, this.ref.des, knn, 2);
        for (let i = 0; i < knn.size(); i++) {
          const m = knn.get(i);
          if (m.size() < 2) continue;
          const m0 = m.get(0),
            m1 = m.get(1);
          if (m0.distance < C.LOWE_RATIO * m1.distance)
            pairs.push({ a: feat.kp[m0.queryIdx], b: this.ref.kp[m0.trainIdx] });
        }
      }
      const full = (H: Mat3) => compose(Sinv, compose(H, S));
      if (pairs.length >= 4) {
        const src = t.add(
          cv.matFromArray(
            pairs.length,
            1,
            cv.CV_32FC2,
            pairs.flatMap((p) => p.a),
          ),
        );
        const dst = t.add(
          cv.matFromArray(
            pairs.length,
            1,
            cv.CV_32FC2,
            pairs.flatMap((p) => p.b),
          ),
        );
        const inl = t.add(new cv.Mat());
        const H = t.add(cv.findHomography(src, dst, cv.RANSAC, C.RANSAC_THRESHOLD, inl));
        if (H && !H.empty()) {
          const h = Array.from(H.data64F as Float64Array) as number[];
          const n = h[8] || 1;
          const hm = h.map((v) => v / n) as Mat3;
          let inliers = 0;
          for (let i = 0; i < inl.rows; i++) if (inl.data[i]) inliers++;
          const sc = Math.sqrt(Math.abs(hm[0] * hm[4] - hm[1] * hm[3]));
          const ok =
            inliers >= C.ALIGN_MIN_INLIERS &&
            Math.abs(hm[6]) < C.ALIGN_PERSPECTIVE_MAX &&
            Math.abs(hm[7]) < C.ALIGN_PERSPECTIVE_MAX &&
            sc >= C.ALIGN_SCALE_MIN &&
            sc <= C.ALIGN_SCALE_MAX;
          if (ok)
            return {
              toRef: full(hm),
              inliers,
              fallback: false,
              identity: false,
              matches: sampleMatches(pairs, (i) => !!inl.data[i], s),
            };
        }
        const sim = ransacSimilarity(
          pairs.map((p) => p.a),
          pairs.map((p) => p.b),
        );
        if (sim && sim.inliers >= C.ALIGN_MIN_INLIERS) {
          const set = new Set(sim.set);
          return {
            toRef: full(sim.m),
            inliers: sim.inliers,
            fallback: true,
            identity: false,
            matches: sampleMatches(pairs, (i) => set.has(i), s),
          };
        }
      }
      return { toRef: [...IDENTITY], inliers: 0, fallback: true, identity: true, matches: [] };
    });
  }
}
