import * as C from '../config';
import type { Face, Frame, Person } from '../types';
import { choosePick, isSwap, type PicksByPerson } from './picks';

export interface BaseEvaluation {
  frameId: string;
  swaps: number;
  /** summed final score over all people */
  sum: number;
  picks: PicksByPerson;
}

export function evaluateBase(frameId: string, people: Person[], faces: Record<string, Face>): BaseEvaluation {
  const picks: PicksByPerson = {};
  let swaps = 0;
  let sum = 0;
  for (const p of people) {
    const c = choosePick(p, frameId, faces);
    picks[p.id] = c.pick;
    if (isSwap(c.pick)) swaps++;
    sum += c.finalScore;
  }
  return { frameId, swaps, sum, picks };
}

/** Number of frames per id holding a face within WIN_EPSILON of that person's best. */
function bestFaceCounts(frames: Frame[], people: Person[], faces: Record<string, Face>): Map<string, number> {
  const wins = new Map(frames.map((f) => [f.id, 0]));
  for (const p of people) {
    const ids = Object.values(p.faces);
    const top = Math.max(...ids.map((id) => faces[id].score.total));
    for (const id of ids) {
      const frameId = faces[id].frameId;
      if (faces[id].score.total >= top - C.WIN_EPSILON) wins.set(frameId, (wins.get(frameId) ?? 0) + 1);
    }
  }
  return wins;
}

/**
 * Best-result-first: the base is the frame whose result (each person at their best feasible face) has the highest
 * summed score. Sums within BASE_SUM_TOL × people count as equal and fall back to fewer swaps (less editing), more
 * best faces already in place, a higher sum, the reference frame, then more background-alignment inliers.
 */
export function chooseBase(
  frames: Frame[],
  people: Person[],
  faces: Record<string, Face>,
  refFrameId: string,
): BaseEvaluation {
  const wins = bestFaceCounts(frames, people, faces);
  const inliers = new Map(frames.map((f) => [f.id, f.alignInliers]));
  const isRef = (e: BaseEvaluation) => (e.frameId === refFrameId ? 1 : 0);
  const evals = frames.map((f) => evaluateBase(f.id, people, faces));
  const tol = C.BASE_SUM_TOL * people.length;
  const top = Math.max(...evals.map((e) => e.sum));
  const close = evals.filter((e) => e.sum >= top - tol);
  close.sort(
    (a, b) =>
      a.swaps - b.swaps ||
      wins.get(b.frameId)! - wins.get(a.frameId)! ||
      b.sum - a.sum ||
      isRef(b) - isRef(a) ||
      inliers.get(b.frameId)! - inliers.get(a.frameId)!,
  );
  return close[0];
}
