import * as C from '../../config';
import type { CV, Tracker } from '../lib/opencv';

/** Patch alpha above this counts as covered by the source (Lanczos softens the patch's own edge). */
const ALPHA_COVERED = 250;
/** Below this many skin pixels, face swaps measure colour over the edge ring instead. */
const MIN_SKIN_PX = 200;
/** Below this many pixels, colour matching is skipped. */
const MIN_STATS_PX = 30;
/** Per-channel colour-transfer gain is clamped to [1/MAX_GAIN, MAX_GAIN]. */
const MAX_GAIN = 2;

function odd(n: number): number {
  const k = Math.max(3, Math.round(n));
  return k % 2 ? k : k + 1;
}

export function blendPatch(
  cv: CV,
  t: Tracker,
  baseData: ImageData,
  patchData: ImageData,
  maskData: ImageData,
  feather: number,
  skinData?: ImageData,
): ImageData {
  const w = baseData.width,
    h = baseData.height;
  const baseRGB = t.add(new cv.Mat()),
    patchRGB = t.add(new cv.Mat());
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
  cv.threshold(alpha, alpha, ALPHA_COVERED, 255, cv.THRESH_BINARY);
  cv.min(mask8, alpha, mask8);
  const maskF = t.add(new cv.Mat());
  const k = odd(feather);
  cv.GaussianBlur(mask8, maskF, new cv.Size(k, k), feather / 2, feather / 2, cv.BORDER_DEFAULT);
  maskF.convertTo(maskF, cv.CV_32F, 1 / 255);

  // colour statistics: face swaps measure over the skin interior (no hair, brows, eyes or mouth);
  // eye swaps, or faces with too little skin, over a ring just inside the mask edge
  const inner = t.add(new cv.Mat());
  cv.threshold(mask8, inner, 127, 255, cv.THRESH_BINARY);
  let region = t.add(new cv.Mat());
  if (skinData) {
    const skin = t.add(new cv.Mat());
    cv.cvtColor(t.add(cv.matFromImageData(skinData)), skin, cv.COLOR_RGBA2GRAY);
    cv.threshold(skin, region, 127, 255, cv.THRESH_BINARY);
    cv.bitwise_and(region, alpha, region); // alpha is 0/255: only where the source covers the ROI
  }
  if (!skinData || cv.countNonZero(region) < MIN_SKIN_PX) {
    const eroded = t.add(new cv.Mat());
    const ek = odd(feather);
    const kernel = t.add(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(ek, ek)));
    cv.erode(inner, eroded, kernel);
    region = t.add(new cv.Mat());
    cv.subtract(inner, eroded, region);
  }
  if (cv.countNonZero(region) > MIN_STATS_PX) matchColors(cv, t, baseRGB, patchRGB, region);

  const out = laplacianBlend(cv, t, baseRGB, patchRGB, maskF);
  const rgba = t.add(new cv.Mat());
  cv.cvtColor(out, rgba, cv.COLOR_RGB2RGBA);
  return new ImageData(new Uint8ClampedArray(rgba.data), w, h);
}

function matchColors(cv: CV, t: Tracker, base: CV, patch: CV, ring: CV) {
  const labB = t.add(new cv.Mat()),
    labP = t.add(new cv.Mat());
  cv.cvtColor(base, labB, cv.COLOR_RGB2Lab);
  cv.cvtColor(patch, labP, cv.COLOR_RGB2Lab);
  const mb = t.add(new cv.Mat()),
    sb = t.add(new cv.Mat()),
    mp = t.add(new cv.Mat()),
    sp = t.add(new cv.Mat());
  cv.meanStdDev(labB, mb, sb, ring);
  cv.meanStdDev(labP, mp, sp, ring);
  const planes = t.add(new cv.MatVector());
  cv.split(labP, planes);
  for (let c = 0; c < 3; c++) {
    const gain = Math.min(MAX_GAIN, Math.max(1 / MAX_GAIN, sb.data64F[c] / Math.max(sp.data64F[c], 1e-3)));
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
  const a = t.add(new cv.Mat()),
    b = t.add(new cv.Mat());
  a8.convertTo(a, cv.CV_32FC3);
  b8.convertTo(b, cv.CV_32FC3);
  const m3 = t.add(new cv.Mat());
  const mv = t.add(new cv.MatVector());
  mv.push_back(mask);
  mv.push_back(mask);
  mv.push_back(mask);
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
  const la = lap(gauss(a)),
    lb = lap(gauss(b)),
    gm = gauss(m3);
  const blended: CV[] = la.map((_, i) => {
    const inv = t.add(new cv.Mat());
    const ones = t.add(new cv.Mat(gm[i].rows, gm[i].cols, gm[i].type(), new cv.Scalar(1, 1, 1)));
    cv.subtract(ones, gm[i], inv);
    const x = t.add(new cv.Mat()),
      y = t.add(new cv.Mat()),
      r = t.add(new cv.Mat());
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
