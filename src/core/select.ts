import * as C from '../config';
import type { Face, Frame, Person, Pick, SwapMode } from '../types';
import { dist, fitSimilarity } from './geometry';
import { funnyPenalty } from './score';

// MediaPipe 478-landmark indices
const RIGID = [33, 133, 362, 263, 6, 168, 10, 338, 297, 332, 284, 251, 21, 54, 103, 67, 109, 162, 389];
const EYE_L = 263, EYE_L_IN = 362, EYE_R = 33, EYE_R_IN = 133;

export interface Feasibility {
  eyes: { ok: boolean; reason?: string };
  face: { ok: boolean; reason?: string };
  dpose: number;
  residual: number;
}

export function interOcular(f: Face, ref = true): number {
  const L = ref ? f.refLandmarks : f.landmarks;
  const mid = (a: number, b: number): [number, number] => [(L[a][0] + L[b][0]) / 2, (L[a][1] + L[b][1]) / 2];
  return dist(mid(EYE_L, EYE_L_IN), mid(EYE_R, EYE_R_IN));
}

export function swapFeasibility(src: Face, base: Face | undefined): Feasibility {
  if (!base) {
    const off = Math.max(Math.abs(src.pose.yaw), Math.abs(src.pose.pitch), Math.abs(src.pose.roll));
    const ok = off <= C.FACE_MAX_DPOSE;
    return {
      eyes: { ok: false, reason: 'no base face' },
      face: ok ? { ok } : { ok, reason: 'head turned too much' },
      dpose: off,
      residual: 0,
    };
  }
  const dpose = Math.max(
    Math.abs(src.pose.yaw - base.pose.yaw),
    Math.abs(src.pose.pitch - base.pose.pitch),
    Math.abs(src.pose.roll - base.pose.roll),
  );
  const a = RIGID.map((i) => src.refLandmarks[i]);
  const b = RIGID.map((i) => base.refLandmarks[i]);
  const residual = fitSimilarity(a, b).rms / Math.max(interOcular(base), 1e-6);
  const turned = 'head turned too much';
  const shape = 'face shape differs too much';
  const eyes =
    dpose > C.EYES_MAX_DPOSE ? { ok: false, reason: turned }
    : residual > C.EYES_MAX_RESIDUAL ? { ok: false, reason: shape }
    : { ok: true };
  const face =
    dpose > C.FACE_MAX_DPOSE ? { ok: false, reason: turned }
    : residual > C.FACE_MAX_RESIDUAL ? { ok: false, reason: shape }
    : { ok: true };
  return { eyes, face, dpose, residual };
}

export function autoMode(src: Face, base: Face | undefined, feas: Feasibility): SwapMode | null {
  if (base && feas.eyes.ok && Math.abs(base.score.smile - src.score.smile) <= C.SMILE_SIMILAR && funnyPenalty(base.blend) === 0)
    return 'eyes';
  if (feas.face.ok) return 'face';
  return null;
}

export interface PersonChoice { pick: Pick; baseScore: number; best: number }

/** True when the pick pastes a face from another frame. */
export const isSwap = (p: Pick | undefined): boolean => p?.mode === 'eyes' || p?.mode === 'face';

/** Best pick for one person given a base frame. */
export function choosePick(person: Person, baseFrameId: string, faces: Record<string, Face>): PersonChoice {
  const baseFace = person.faces[baseFrameId] ? faces[person.faces[baseFrameId]] : undefined;
  // Not detected in the base frame: the person is usually still there (turned away, looking down), so pasting a
  // face would create a double "ghost" face. Leave the photo untouched; the user can still pick a face manually.
  if (!baseFace) return { pick: { personId: person.id, faceId: '', mode: 'skip', auto: true }, baseScore: 0, best: 0 };
  const baseScore = baseFace.score.total;
  let best: { face: Face; mode: SwapMode } | null = null;
  for (const fid of Object.values(person.faces)) {
    if (fid === baseFace?.id) continue;
    const src = faces[fid];
    const mode = autoMode(src, baseFace, swapFeasibility(src, baseFace));
    if (!mode) continue;
    if (!best || src.score.total > best.face.score.total) best = { face: src, mode };
  }
  if (best && best.face.score.total - baseScore > C.SWAP_GAIN_MIN) {
    return {
      pick: { personId: person.id, faceId: best.face.id, mode: best.mode, auto: true },
      baseScore,
      best: best.face.score.total,
    };
  }
  return { pick: { personId: person.id, faceId: baseFace.id, mode: 'base', auto: true }, baseScore, best: baseScore };
}

export interface BaseEvaluation { frameId: string; swaps: number; sum: number; inliers: number; picks: Record<string, Pick> }

export function evaluateBase(frame: Frame, people: Person[], faces: Record<string, Face>): BaseEvaluation {
  const picks: Record<string, Pick> = {};
  let swaps = 0, sum = 0;
  for (const p of people) {
    const c = choosePick(p, frame.id, faces);
    picks[p.id] = c.pick;
    if (isSwap(c.pick)) swaps++;
    sum += isSwap(c.pick) ? c.best : c.baseScore;
  }
  return { frameId: frame.id, swaps, sum, inliers: frame.alignInliers, picks };
}

/**
 * Best-face-first: every person's highest-scoring face is the goal. The base is the frame that already holds the
 * most of those best faces (ties within WIN_EPSILON count as wins), then the highest summed score, then the
 * best alignment; everyone else is swapped to their best feasible face.
 */
export function chooseBase(frames: Frame[], people: Person[], faces: Record<string, Face>): BaseEvaluation {
  const wins = new Map(frames.map((f) => [f.id, 0]));
  for (const p of people) {
    const ids = Object.values(p.faces);
    const top = Math.max(...ids.map((id) => faces[id].score.total));
    for (const id of ids) {
      if (faces[id].score.total >= top - C.WIN_EPSILON) wins.set(faces[id].frameId, (wins.get(faces[id].frameId) ?? 0) + 1);
    }
  }
  const evals = frames.map((f) => evaluateBase(f, people, faces));
  evals.sort((a, b) => wins.get(b.frameId)! - wins.get(a.frameId)! || b.sum - a.sum || b.inliers - a.inliers);
  return evals[0];
}

/** Re-pick for a new base frame, keeping manual picks that are still feasible. */
export function rebase(
  frame: Frame,
  people: Person[],
  faces: Record<string, Face>,
  oldPicks: Record<string, Pick>,
): Record<string, Pick> {
  const fresh = evaluateBase(frame, people, faces).picks;
  for (const p of people) {
    const old = oldPicks[p.id];
    if (!old || old.auto) continue;
    const baseFace = p.faces[frame.id] ? faces[p.faces[frame.id]] : undefined;
    if (old.faceId === baseFace?.id) {
      fresh[p.id] = { ...old, mode: 'base' };
      continue;
    }
    if (old.mode === 'skip') {
      if (!baseFace) fresh[p.id] = old;
      continue;
    }
    if (old.mode === 'base') continue;
    const feas = swapFeasibility(faces[old.faceId], baseFace);
    if (feas[old.mode].ok) fresh[p.id] = old;
  }
  return fresh;
}

/**
 * Amber "check this" faces: a low-scoring final face, or a person seen in at least half the frames who has no face
 * in the base frame (short-lived clusters are usually grouping fragments and would only add noise).
 */
export function needsAttention(person: Person, pick: Pick | undefined, faces: Record<string, Face>, frameCount: number): boolean {
  if (!pick) return true;
  if (pick.mode === 'skip') return Object.keys(person.faces).length >= frameCount / 2;
  return (faces[pick.faceId]?.score.total ?? 0) < C.LOW_CONFIDENCE_TOTAL;
}
