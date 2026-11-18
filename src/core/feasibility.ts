import * as C from '../config';
import type { Face, SwapMode } from '../types';
import { dist, fitSimilarity } from './geometry';
import { EYE_CORNERS, RIGID_POINTS } from './landmarks';
import { funnyPenalty } from './scoring';

export interface ModeFeasibility {
  ok: boolean;
  reason?: string;
}

/** Whether a source face can replace a base face of the same person, per swap mode. */
export interface Feasibility {
  eyes: ModeFeasibility;
  face: ModeFeasibility;
  /** largest yaw/pitch/roll difference, degrees */
  dpose: number;
  /** RMS of the rigid-landmark similarity fit, in inter-ocular distances */
  residual: number;
}

const TURNED = 'head turned too much';
const SHAPE = 'face shape differs too much';

/** Distance between the two eye centres, in reference-frame coordinates. */
function interOcular(f: Face): number {
  const L = f.refLandmarks;
  const mid = (a: number, b: number): [number, number] => [(L[a][0] + L[b][0]) / 2, (L[a][1] + L[b][1]) / 2];
  const { left, right } = EYE_CORNERS;
  return dist(mid(left.outer, left.inner), mid(right.outer, right.inner));
}

function check(dpose: number, residual: number, maxDpose: number, maxResidual: number): ModeFeasibility {
  if (dpose > maxDpose) return { ok: false, reason: TURNED };
  if (residual > maxResidual) return { ok: false, reason: SHAPE };
  return { ok: true };
}

export function swapFeasibility(src: Face, base: Face | undefined): Feasibility {
  if (!base) {
    const off = Math.max(Math.abs(src.pose.yaw), Math.abs(src.pose.pitch), Math.abs(src.pose.roll));
    const ok = off <= C.FACE_MAX_DPOSE;
    return {
      eyes: { ok: false, reason: 'no base face' },
      face: ok ? { ok } : { ok, reason: TURNED },
      dpose: off,
      residual: 0,
    };
  }
  const dpose = Math.max(
    Math.abs(src.pose.yaw - base.pose.yaw),
    Math.abs(src.pose.pitch - base.pose.pitch),
    Math.abs(src.pose.roll - base.pose.roll),
  );
  const a = RIGID_POINTS.map((i) => src.refLandmarks[i]);
  const b = RIGID_POINTS.map((i) => base.refLandmarks[i]);
  const residual = fitSimilarity(a, b).rms / Math.max(interOcular(base), 1e-6);
  return {
    eyes: check(dpose, residual, C.EYES_MAX_DPOSE, C.EYES_MAX_RESIDUAL),
    face: check(dpose, residual, C.FACE_MAX_DPOSE, C.FACE_MAX_RESIDUAL),
    dpose,
    residual,
  };
}

/**
 * The swap mode auto-selection would use: eyes when only the eyes differ (similar smile, no funny face on the base),
 * otherwise a whole-face swap, or null when neither is feasible.
 */
export function autoMode(src: Face, base: Face | undefined, feasibility: Feasibility): SwapMode | null {
  const eyesOnly =
    base &&
    feasibility.eyes.ok &&
    Math.abs(base.score.smile - src.score.smile) <= C.SMILE_SIMILAR &&
    funnyPenalty(base.blend) === 0;
  if (eyesOnly) return 'eyes';
  if (feasibility.face.ok) return 'face';
  return null;
}
