import * as C from '../config';
import type { Face, FacePick, Person, SwapMode } from '../types';
import { autoMode, swapFeasibility } from './feasibility';
import { faceInFrame } from './session';

export type PicksByPerson = Record<string, FacePick>;

/** True when the pick pastes a face from another frame. */
export const isSwap = (p: FacePick | undefined): boolean => p?.mode === 'eyes' || p?.mode === 'face';

export interface PersonChoice {
  pick: FacePick;
  /** score of the person's face in the base frame (0 if absent) */
  baseScore: number;
  /** score of the face the pick ends up showing */
  finalScore: number;
}

/** Best automatic pick for one person given a base frame. */
export function choosePick(person: Person, baseFrameId: string, faces: Record<string, Face>): PersonChoice {
  const baseFace = faceInFrame(person, baseFrameId, faces);
  // Not detected in the base frame: the person is usually still there (turned away, looking down), so pasting a
  // face would create a double "ghost" face. Leave the photo untouched; the user can still pick a face manually.
  if (!baseFace) {
    return { pick: { personId: person.id, faceId: '', mode: 'skip', auto: true }, baseScore: 0, finalScore: 0 };
  }
  const baseScore = baseFace.score.total;
  let best: { face: Face; mode: SwapMode } | null = null;
  for (const faceId of Object.values(person.faces)) {
    if (faceId === baseFace.id) continue;
    const src = faces[faceId];
    const mode = autoMode(src, baseFace, swapFeasibility(src, baseFace));
    if (!mode) continue;
    if (!best || src.score.total > best.face.score.total) best = { face: src, mode };
  }
  if (best && best.face.score.total - baseScore > C.SWAP_GAIN_MIN) {
    return {
      pick: { personId: person.id, faceId: best.face.id, mode: best.mode, auto: true },
      baseScore,
      finalScore: best.face.score.total,
    };
  }
  return {
    pick: { personId: person.id, faceId: baseFace.id, mode: 'base', auto: true },
    baseScore,
    finalScore: baseScore,
  };
}

export function autoPicks(baseFrameId: string, people: Person[], faces: Record<string, Face>): PicksByPerson {
  return Object.fromEntries(people.map((p) => [p.id, choosePick(p, baseFrameId, faces).pick]));
}

/** Re-pick for a new base frame, keeping manual picks that are still feasible. */
export function rebase(
  baseFrameId: string,
  people: Person[],
  faces: Record<string, Face>,
  oldPicks: PicksByPerson,
): PicksByPerson {
  const fresh = autoPicks(baseFrameId, people, faces);
  for (const p of people) {
    const old = oldPicks[p.id];
    if (!old || old.auto) continue;
    const baseFace = faceInFrame(p, baseFrameId, faces);
    if (old.faceId === baseFace?.id) {
      fresh[p.id] = { ...old, mode: 'base' };
      continue;
    }
    if (old.mode === 'skip') {
      if (!baseFace) fresh[p.id] = old;
      continue;
    }
    if (old.mode === 'base') continue;
    if (swapFeasibility(faces[old.faceId], baseFace)[old.mode].ok) fresh[p.id] = old;
  }
  return fresh;
}

/**
 * Amber "check this" faces: a low-scoring final face, or a person seen in at least half the frames who has no face
 * in the base frame (short-lived clusters are usually grouping fragments and would only add noise).
 */
export function needsAttention(
  person: Person,
  pick: FacePick | undefined,
  faces: Record<string, Face>,
  frameCount: number,
): boolean {
  if (!pick) return true;
  if (pick.mode === 'skip') return Object.keys(person.faces).length >= frameCount / 2;
  return (faces[pick.faceId]?.score.total ?? 0) < C.LOW_CONFIDENCE_TOTAL;
}
