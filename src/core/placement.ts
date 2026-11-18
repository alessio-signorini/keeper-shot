import * as C from '../config';
import type { Box, Face, FacePick, Mat3, Pt, Session } from '../types';
import { applyAll, boxOf, boxesOverlap, compose, expandBox, fitSimilarity, invert, scaleMat } from './geometry';
import { RIGID_POINTS } from './landmarks';
import { baseFrame, faceInFrame, frameById, personById } from './session';

/** Source→base transform (full-res coords), refined by a similarity fit on rigid landmarks when the base face exists. */
export function sourceToBase(session: Session, src: Face, baseFace: Face | undefined): Mat3 {
  const global = compose(invert(baseFrame(session).toRef), frameById(session.frames, src.frameId).toRef);
  if (!baseFace) return global;
  const fit = fitSimilarity(
    RIGID_POINTS.map((i) => src.landmarks[i]),
    RIGID_POINTS.map((i) => baseFace.landmarks[i]),
  );
  return isFinite(fit.rms) ? fit.m : global;
}

export interface SwapPlacement {
  /** source pixels → output pixels, both at `scale` */
  srcToOut: Mat3;
  /** source landmarks mapped into output pixels */
  mapped: Pt[];
  /** output region the swap touches */
  roi: Box;
}

/** Where a pick lands in a base canvas of W×H pixels rendered at `scale` (output px per full-res px). */
export function placeSwap(session: Session, pick: FacePick, scale: number, W: number, H: number): SwapPlacement {
  const src = session.faces[pick.faceId];
  const baseFace = faceInFrame(personById(session, pick.personId), session.baseFrameId, session.faces);
  const T = sourceToBase(session, src, baseFace);
  const S = scaleMat(scale);
  const srcToOut = compose(S, compose(T, invert(S)));
  const mapped = applyAll(compose(S, T), src.landmarks);
  return { srcToOut, mapped, roi: expandBox(boxOf(mapped), C.ROI_SCALE, W, H) };
}

/** Identifies what a swap pastes; a person's swap is redone when this changes. */
export const swapKey = (p: FacePick) => `${p.faceId}:${p.mode}`;

export interface SwapRegion {
  key: string;
  roi: Box;
}

/**
 * Incremental update plan, keyed by person id. Changed or removed swaps make their ROIs dirty; wanted swaps that
 * changed, or overlap any dirty region (transitively), must be redone after the dirty regions are restored.
 */
export function planIncrementalUpdate(
  applied: Map<string, SwapRegion>,
  wanted: Map<string, SwapRegion>,
): { dirty: Box[]; redo: Set<string> } {
  const dirty: Box[] = [];
  const redo = new Set<string>();
  for (const [id, a] of applied) {
    if (wanted.get(id)?.key !== a.key) dirty.push(a.roi);
  }
  for (const [id, w] of wanted) {
    if (applied.get(id)?.key !== w.key) {
      dirty.push(w.roi);
      redo.add(id);
    }
  }
  for (let grew = true; grew;) {
    grew = false;
    for (const [id, w] of wanted) {
      if (redo.has(id) || !dirty.some((d) => boxesOverlap(d, w.roi))) continue;
      redo.add(id);
      dirty.push(w.roi);
      grew = true;
    }
  }
  return { dirty, redo };
}
