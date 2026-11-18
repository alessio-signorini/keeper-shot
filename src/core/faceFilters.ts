import * as C from '../config';
import type { Box, Face, Person } from '../types';

/**
 * Drop detections much smaller than the frame's typical face. In group shots real faces (kids and adults, front
 * and back rows) stay within ~1.4x of each other; much smaller hits are feet, patterns, prints or distant passers-by.
 */
export function dropSmallOutliers<T extends { box: Box }>(faces: T[]): T[] {
  if (faces.length < C.MIN_REL_FACE_COUNT) return faces;
  const ws = faces.map((f) => f.box.w).sort((a, b) => a - b);
  const median = ws[Math.floor(ws.length / 2)];
  return faces.filter((f) => f.box.w >= median * C.MIN_REL_FACE);
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
export function implausibleGaze(blend: Record<string, number>): boolean {
  return GAZE.filter((k) => (blend[k] ?? 0) > C.GAZE_SATURATED).length >= C.GAZE_SATURATED_MAX;
}

/** Drop people whose faces are far blurrier than everyone else's: out-of-focus background that looked like a face. */
export function dropBlurryPeople(people: Person[], faces: Record<string, Face>): Person[] {
  if (people.length < C.MIN_REL_FACE_COUNT) return people;
  const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const sharp = people.map((p) => med(Object.values(p.faces).map((id) => faces[id].sharpness)));
  const floor = med(sharp) * C.MIN_REL_SHARPNESS;
  return people.filter((_, i) => sharp[i] >= floor);
}
