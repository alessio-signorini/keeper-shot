import * as C from '../config';
import type { Box } from '../types';
import { median } from './stats';

/**
 * Drop detections much smaller than the frame's typical face. In group shots real faces (kids and adults, front
 * and back rows) stay within ~1.4x of each other; much smaller hits are feet, patterns, prints or distant passers-by.
 */
export function dropSmallOutliers<T extends { box: Box }>(faces: T[]): T[] {
  if (faces.length < C.MIN_REL_FACE_COUNT) return faces;
  const typical = median(faces.map((f) => f.box.w));
  return faces.filter((f) => f.box.w >= typical * C.MIN_REL_FACE);
}

const GAZE = [
  'eyeLookInLeft',
  'eyeLookOutLeft',
  'eyeLookUpLeft',
  'eyeLookDownLeft',
  'eyeLookInRight',
  'eyeLookOutRight',
  'eyeLookUpRight',
  'eyeLookDownRight',
];

/**
 * Non-faces that slip through (feet, background patterns) get landmarks whose "eyes" look to extremes in several
 * directions at once; real faces in our test bursts stayed below 0.9 on every gaze blendshape.
 */
export function implausibleGaze(blendshapes: Record<string, number>): boolean {
  return GAZE.filter((k) => (blendshapes[k] ?? 0) > C.GAZE_SATURATED).length >= C.GAZE_SATURATED_MAX;
}
