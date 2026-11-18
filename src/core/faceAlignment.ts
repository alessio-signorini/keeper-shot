import * as C from '../config';
import type { Box, Face, Frame, Mat3, Pt } from '../types';
import { apply, center, fitSimilarity } from './geometry';
import { ALIGN_POINTS } from './landmarks';
import { facesOfFrame } from './session';
import { median } from './stats';

export interface AlignFace {
  box: Box;
  landmarks: Pt[];
}
export interface FaceMatch {
  a: number;
  b: number;
  d: number;
}

/** Greedy one-to-one matching of A's faces (mapped by m) to B's faces; d is the centre distance in B face widths. */
export function matchFaces(m: Mat3, A: AlignFace[], B: AlignFace[], tol: number): FaceMatch[] {
  const cand: FaceMatch[] = [];
  A.forEach((fa, a) => {
    const p = apply(m, center(fa.box));
    B.forEach((fb, b) => {
      const c = center(fb.box);
      const d = Math.hypot(p[0] - c[0], p[1] - c[1]) / Math.max(fb.box.w, 1);
      if (d < tol) cand.push({ a, b, d });
    });
  });
  cand.sort((x, y) => x.d - y.d);
  const ua = new Set<number>(),
    ub = new Set<number>(),
    out: FaceMatch[] = [];
  for (const c of cand) {
    if (ua.has(c.a) || ub.has(c.b)) continue;
    ua.add(c.a);
    ub.add(c.b);
    out.push(c);
  }
  return out;
}

function refine(m: Mat3, A: AlignFace[], B: AlignFace[]): Mat3 {
  for (const tol of C.FACE_ALIGN_REFINE_TOLS) {
    const pairs = matchFaces(m, A, B, tol);
    if (pairs.length < C.FACE_ALIGN_MIN_FACES) break;
    const src = pairs.flatMap((p) => ALIGN_POINTS.map((i) => A[p.a].landmarks[i]));
    const dst = pairs.flatMap((p) => ALIGN_POINTS.map((i) => B[p.b].landmarks[i]));
    const fit = fitSimilarity(src, dst);
    if (!isFinite(fit.rms)) break;
    m = fit.m;
  }
  return m;
}

export interface FaceAlignment {
  m: Mat3;
  matched: number;
  err: number;
}

/** How well a transform lines up A's faces with B's faces. */
export function scoreAlignment(m: Mat3, A: AlignFace[], B: AlignFace[]): FaceAlignment {
  const pairs = matchFaces(m, A, B, C.FACE_ALIGN_TOL);
  return { m, matched: pairs.length, err: pairs.length ? median(pairs.map((p) => p.d)) : Infinity };
}

/**
 * Align frame A to frame B using the faces themselves. Each face pair (with plausible relative size) seeds a
 * scale+translation hypothesis; the best few are refined with a similarity fit on the landmarks of matched faces.
 * People mostly hold their place in a group, so this tracks the group even when the background (far away, or
 * featureless grass) aligns differently from the people.
 */
export function alignByFaces(A: AlignFace[], B: AlignFace[], seed?: Mat3): FaceAlignment | null {
  if (A.length < C.FACE_ALIGN_MIN_FACES || B.length < C.FACE_ALIGN_MIN_FACES) return null;
  const hyps: Mat3[] = seed ? [seed] : [];
  for (const fa of A) {
    for (const fb of B) {
      const k = fb.box.w / Math.max(fa.box.w, 1);
      if (k < C.ALIGN_SCALE_MIN || k > C.ALIGN_SCALE_MAX) continue;
      const [ax, ay] = center(fa.box),
        [bx, by] = center(fb.box);
      hyps.push([k, 0, bx - k * ax, 0, k, by - k * ay, 0, 0, 1]);
    }
  }
  const top = hyps
    .map((m) => ({ m, n: matchFaces(m, A, B, C.FACE_ALIGN_SEED_TOL).length }))
    .sort((x, y) => y.n - x.n)
    .slice(0, C.FACE_ALIGN_TOP);
  let best: FaceAlignment | null = null;
  for (const h of top) {
    const r = scoreAlignment(refine(h.m, A, B), A, B);
    const sc = Math.hypot(r.m[0], r.m[3]);
    if (sc < C.ALIGN_SCALE_MIN || sc > C.ALIGN_SCALE_MAX) continue;
    if (!best || r.matched > best.matched || (r.matched === best.matched && r.err < best.err)) best = r;
  }
  return best && best.matched >= C.FACE_ALIGN_MIN_FACES ? best : null;
}

/** True when `a` lines up more faces than `b`, or as many with a smaller median error. */
export function linesUpBetter(a: FaceAlignment, b: FaceAlignment): boolean {
  return a.matched > b.matched || (a.matched === b.matched && a.err < b.err);
}

export interface FrameTransformChoice {
  toRef: Mat3;
  method: 'orb' | 'faces';
  /** set when the faces won */
  byFaces?: FaceAlignment;
}

/**
 * The background can align differently from the people (parallax, featureless grass): keep whichever of the
 * background transform and the face-based one lines up more of the group's faces with the reference frame.
 */
export function chooseFrameTransform(
  backgroundToRef: Mat3,
  frameFaces: AlignFace[],
  refFaces: AlignFace[],
): FrameTransformChoice {
  const current = scoreAlignment(backgroundToRef, frameFaces, refFaces);
  const byFaces = alignByFaces(frameFaces, refFaces, backgroundToRef);
  if (byFaces && linesUpBetter(byFaces, current)) return { toRef: byFaces.m, method: 'faces', byFaces };
  return { toRef: backgroundToRef, method: 'orb' };
}

/**
 * Frames where people moved too much to line up with the reference (fewer than FRAME_MIN_ALIGNED of its faces
 * match) can't be merged cleanly. Returns their ids, or nothing if dropping them would leave fewer than FRAME_MIN_KEPT.
 */
export function misalignedFrames(frames: Frame[], faces: Record<string, Face>, refFrameId: string): Set<string> {
  const refFaces = facesOfFrame(faces, refFrameId);
  if (!refFaces.length) return new Set();
  const drop = new Set(
    frames
      .filter((f) => f.id !== refFrameId)
      .filter(
        (f) =>
          scoreAlignment(f.toRef, facesOfFrame(faces, f.id), refFaces).matched / refFaces.length < C.FRAME_MIN_ALIGNED,
      )
      .map((f) => f.id),
  );
  return drop.size && frames.length - drop.size >= C.FRAME_MIN_KEPT ? drop : new Set();
}
