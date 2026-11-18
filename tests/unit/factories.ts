import { scoreFace } from '../../src/core/scoring';
import type { Face, Frame, Pt } from '../../src/types';

// Synthetic faces/frames for core tests. Landmarks are a deterministic pseudo-random grid around the centre.

export function landmarkGrid(cx: number, cy: number, size: number): Pt[] {
  // 478 points on a small grid around center; index-specific eye points are spread plausibly
  const pts: Pt[] = [];
  for (let i = 0; i < 478; i++)
    pts.push([cx + (((i * 37) % 100) / 100 - 0.5) * size, cy + (((i * 53) % 100) / 100 - 0.5) * size]);
  return pts;
}

export function makeFace(
  frameId: string,
  i: number,
  cx: number,
  cy: number,
  o: Partial<Face> = {},
  blend: Record<string, number> = {},
): Face {
  const size = 100;
  const pose = o.pose ?? { yaw: 0, pitch: 0, roll: 0 };
  const l = landmarkGrid(cx, cy, size);
  return {
    id: `${frameId}:${i}`,
    frameId,
    landmarks: l,
    refLandmarks: l,
    box: { x: cx - 50, y: cy - 50, w: 100, h: 100 },
    refBox: { x: cx - 50, y: cy - 50, w: 100, h: 100 },
    blend,
    pose,
    sharpness: 1,
    score: scoreFace(blend, pose, 1),
    thumbKey: '',
    ...o,
  };
}

export const makeFrame = (id: string, inliers = 100): Frame => ({
  id,
  name: id,
  blobKey: id,
  width: 1000,
  height: 1000,
  toRef: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  alignInliers: inliers,
  exif: {},
});
