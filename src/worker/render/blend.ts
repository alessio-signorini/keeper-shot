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

/**
 * Blend a warped source patch into the base ROI: feathered mask ∧ source coverage, Lab colour transfer, Laplacian
 * pyramid blend. Mats are released as soon as they are dead: the WASM heap keeps its high-water mark forever, and for
 * large ROIs (close-ups) the pyramid would otherwise hold ~19 full-size float images at once.
 */
export function blendPatch(
  cv: CV,
  t: Tracker,
  baseData: ImageData,
  patchData: ImageData,
  maskData: ImageData,
  feather: number,
  skinData?: ImageData,
): ImageData {
  const w = baseData.width;
  const h = baseData.height;
  const baseRGB = t.add(new cv.Mat());
  const baseRGBA = t.add(cv.matFromImageData(baseData));
  cv.cvtColor(baseRGBA, baseRGB, cv.COLOR_RGBA2RGB);
  t.release(baseRGBA);
  const patchRGB = t.add(new cv.Mat());
  const patchRGBA = t.add(cv.matFromImageData(patchData));
  cv.cvtColor(patchRGBA, patchRGB, cv.COLOR_RGBA2RGB);

  // mask 0..1 float: polygon ∧ patch alpha, feathered
  const mask8 = t.add(new cv.Mat());
  const maskRGBA = t.add(cv.matFromImageData(maskData));
  cv.cvtColor(maskRGBA, mask8, cv.COLOR_RGBA2GRAY);
  t.release(maskRGBA);
  const alpha = t.add(new cv.Mat());
  const chans = t.add(new cv.MatVector());
  cv.split(patchRGBA, chans);
  const alphaChan = t.add(chans.get(3));
  alphaChan.copyTo(alpha);
  t.release(alphaChan, chans, patchRGBA);
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
  t.release(mask8);
  let region = t.add(new cv.Mat());
  if (skinData) {
    const skin = t.add(new cv.Mat());
    const skinRGBA = t.add(cv.matFromImageData(skinData));
    cv.cvtColor(skinRGBA, skin, cv.COLOR_RGBA2GRAY);
    t.release(skinRGBA);
    cv.threshold(skin, region, 127, 255, cv.THRESH_BINARY);
    t.release(skin);
    cv.bitwise_and(region, alpha, region); // alpha is 0/255: only where the source covers the ROI
  }
  t.release(alpha);
  if (!skinData || cv.countNonZero(region) < MIN_SKIN_PX) {
    const eroded = t.add(new cv.Mat());
    const ek = odd(feather);
    const kernel = t.add(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(ek, ek)));
    cv.erode(inner, eroded, kernel);
    t.release(region, kernel);
    region = t.add(new cv.Mat());
    cv.subtract(inner, eroded, region);
    t.release(eroded);
  }
  t.release(inner);
  if (cv.countNonZero(region) > MIN_STATS_PX) matchColors(cv, t, baseRGB, patchRGB, region);
  t.release(region);

  const out = laplacianBlend(cv, t, baseRGB, patchRGB, maskF);
  const rgba = t.add(new cv.Mat());
  cv.cvtColor(out, rgba, cv.COLOR_RGB2RGBA);
  t.release(out);
  const result = new ImageData(new Uint8ClampedArray(rgba.data), w, h);
  t.release(rgba);
  return result;
}

/** Lab mean/std transfer of `patch` (in place) toward `base`, with statistics measured over `region`. */
function matchColors(cv: CV, t: Tracker, base: CV, patch: CV, region: CV) {
  const labB = t.add(new cv.Mat());
  const labP = t.add(new cv.Mat());
  cv.cvtColor(base, labB, cv.COLOR_RGB2Lab);
  cv.cvtColor(patch, labP, cv.COLOR_RGB2Lab);
  const mb = t.add(new cv.Mat());
  const sb = t.add(new cv.Mat());
  const mp = t.add(new cv.Mat());
  const sp = t.add(new cv.Mat());
  cv.meanStdDev(labB, mb, sb, region);
  t.release(labB);
  cv.meanStdDev(labP, mp, sp, region);
  const planes = t.add(new cv.MatVector());
  cv.split(labP, planes);
  for (let c = 0; c < 3; c++) {
    const gain = Math.min(MAX_GAIN, Math.max(1 / MAX_GAIN, sb.data64F[c] / Math.max(sp.data64F[c], 1e-3)));
    const beta = mb.data64F[c] - mp.data64F[c] * gain;
    const ch = t.add(planes.get(c));
    const adj = t.add(new cv.Mat());
    ch.convertTo(adj, cv.CV_8U, gain, beta);
    planes.set(c, adj);
    t.release(ch, adj);
  }
  cv.merge(planes, labP);
  t.release(planes, mb, sb, mp, sp);
  cv.cvtColor(labP, patch, cv.COLOR_Lab2RGB);
  t.release(labP);
}

/**
 * Laplacian-pyramid blend: result = Σ levels of lap(a)·(1−m) + lap(b)·m, collapsed. Consumes (releases) its inputs.
 * Each level is built, blended and freed while walking down the Gaussian pyramids, so only the current level's
 * images plus the (small) blended pyramid are alive at once.
 */
function laplacianBlend(cv: CV, t: Tracker, a8: CV, b8: CV, mask: CV): CV {
  const levels = Math.max(1, Math.min(C.PYRAMID_LEVELS, Math.floor(Math.log2(Math.min(a8.cols, a8.rows))) - 2));
  let ga = t.add(new cv.Mat());
  a8.convertTo(ga, cv.CV_32FC3);
  t.release(a8);
  let gb = t.add(new cv.Mat());
  b8.convertTo(gb, cv.CV_32FC3);
  t.release(b8);
  let gm = t.add(new cv.Mat());
  const mv = t.add(new cv.MatVector());
  mv.push_back(mask);
  mv.push_back(mask);
  mv.push_back(mask);
  cv.merge(mv, gm);
  t.release(mv, mask);

  /** next Gaussian level of `g`, and the Laplacian level g − up(next); releases `g` */
  const step = (g: CV): { next: CV; lap: CV } => {
    const next = t.add(new cv.Mat());
    cv.pyrDown(g, next);
    const up = t.add(new cv.Mat());
    cv.pyrUp(next, up, new cv.Size(g.cols, g.rows));
    const lap = t.add(new cv.Mat());
    cv.subtract(g, up, lap);
    t.release(up, g);
    return { next, lap };
  };

  const blended: CV[] = [];
  for (let i = 0; i <= levels; i++) {
    let la = ga;
    let lb = gb;
    let nextM: CV | null = null;
    if (i < levels) {
      const sa = step(ga);
      la = sa.lap;
      ga = sa.next;
      const sb = step(gb);
      lb = sb.lap;
      gb = sb.next;
      nextM = t.add(new cv.Mat());
      cv.pyrDown(gm, nextM);
    }
    const ones = t.add(new cv.Mat(gm.rows, gm.cols, gm.type(), new cv.Scalar(1, 1, 1)));
    const inv = t.add(new cv.Mat());
    cv.subtract(ones, gm, inv);
    t.release(ones);
    const x = t.add(new cv.Mat());
    cv.multiply(la, inv, x);
    t.release(la, inv);
    const y = t.add(new cv.Mat());
    cv.multiply(lb, gm, y);
    t.release(lb, gm);
    const r = t.add(new cv.Mat());
    cv.add(x, y, r);
    t.release(x, y);
    blended.push(r);
    if (nextM) gm = nextM;
  }

  let cur = blended[levels];
  for (let i = levels - 1; i >= 0; i--) {
    const up = t.add(new cv.Mat());
    cv.pyrUp(cur, up, new cv.Size(blended[i].cols, blended[i].rows));
    t.release(cur);
    const sum = t.add(new cv.Mat());
    cv.add(up, blended[i], sum);
    t.release(up, blended[i]);
    cur = sum;
  }
  const out = t.add(new cv.Mat());
  cur.convertTo(out, cv.CV_8UC3);
  t.release(cur);
  return out;
}
