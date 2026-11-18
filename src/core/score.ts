import * as C from '../config';
import type { FaceScore } from '../types';
import { clamp } from './geometry';

type Blend = Record<string, number>;
const g = (b: Blend, k: string) => b[k] ?? 0;

export function eyesScore(b: Blend): number {
  return 1 - Math.max(g(b, 'eyeBlinkLeft'), g(b, 'eyeBlinkRight'));
}

export function gazeScore(b: Blend): number {
  const eye = (s: 'Left' | 'Right') =>
    Math.max(g(b, `eyeLookIn${s}`), g(b, `eyeLookOut${s}`), g(b, `eyeLookUp${s}`), g(b, `eyeLookDown${s}`));
  return 1 - clamp((eye('Left') + eye('Right')) / 2, 0, 1);
}

export function poseScore(p: { yaw: number; pitch: number }): number {
  return 1 - clamp((Math.abs(p.yaw) + Math.abs(p.pitch)) / C.POSE_RANGE_DEG, 0, 1);
}

/** Penalty for funny faces (open jaw, tongue, puffed cheeks, pucker). */
export function funnyPenalty(b: Blend): number {
  return (
    0.5 * Math.max(g(b, 'jawOpen') - C.JAW_OPEN_FREE, 0) +
    g(b, 'tongueOut') +
    Math.max(Math.max(g(b, 'cheekPuff'), g(b, 'mouthPucker')) - C.FUNNY_FREE, 0)
  );
}

export function smileScore(b: Blend): number {
  const s = (g(b, 'mouthSmileLeft') + g(b, 'mouthSmileRight')) / 2;
  return clamp(s - funnyPenalty(b), 0, 1);
}

/**
 * `eyesRef` is the person's most-open eyes score across the burst: eye openness varies a lot between people
 * (and with smiling), so a blink is also flagged when eyes drop well below that person's own best.
 */
export function scoreFace(
  blend: Blend,
  pose: { yaw: number; pitch: number },
  sharpNorm: number,
  eyesRef = 1,
): FaceScore {
  const eyes = eyesScore(blend);
  const gaze = gazeScore(blend);
  const p = poseScore(pose);
  const smile = smileScore(blend);
  const w = C.SCORE_WEIGHTS;
  let total = w.eyes * eyes + w.gaze * gaze + w.pose * p + w.smile * smile + w.sharp * sharpNorm;
  if (isBlink(eyes, eyesRef)) total *= C.BLINK_PENALTY;
  return { eyes, gaze, pose: p, smile, sharp: sharpNorm, total };
}

/** Min-max normalize sharpness values within one person's cluster. */
export function normalizeSharpness(values: number[]): number[] {
  if (!values.length) return [];
  const lo = Math.min(...values),
    hi = Math.max(...values);
  if (hi - lo < 1e-9) return values.map(() => 1);
  return values.map((v) => (v - lo) / (hi - lo));
}

export function isBlink(eyes: number, eyesRef = 1): boolean {
  return eyes < C.BLINK_THRESHOLD || eyes < C.BLINK_REL * eyesRef;
}
