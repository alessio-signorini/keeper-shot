import * as C from '../config';
import type { Pt } from '../types';
import { boxOf, convexHull, scaleAboutCentroid } from './geometry';
import { BROWS, EYE_REGIONS, FACE_OVAL, LIPS } from './landmarks';

// Shape constants for the mask polygons (fractions of the face or eye box).
/** Extra lift of the oval above the brows, on top of FACE_FOREHEAD_RAISE. */
const FOREHEAD_EXTRA = 0.3;
/** Oval points lower than this (× face height, below the centre) count as jawline and are pulled inward. */
const JAW_START = 0.25;
/** How far the lower lid is pushed down into the cheek, × eye width. */
const CHEEK_DROP = 0.5;
/** Skin region: the face mask shrunk to this fraction, minus the eyes+brows and the lips grown by these factors. */
const SKIN_SHRINK = 0.8;
const SKIN_EXCLUDE_EYES = 1.25;
const SKIN_EXCLUDE_LIPS = 1.3;

export interface MaskPolygon {
  poly: Pt[];
  /** blur radius for the mask edge, in the landmarks' pixels */
  feather: number;
}

/** Mask polygons (in the landmarks' coordinate space) for a face swap, or one per eye for an eye swap. */
export function maskPolygons(L: Pt[], mode: 'face' | 'eyes'): MaskPolygon[] {
  if (mode === 'face') {
    const oval = FACE_OVAL.map((i) => L[i]);
    const box = boxOf(oval);
    const brow = boxOf(BROWS.map((i) => L[i]));
    const cy = box.y + box.h / 2;
    const pts = oval.map((p): Pt => {
      if (p[1] < brow.y) return [p[0], p[1] - (cy - p[1]) * C.FACE_FOREHEAD_RAISE * FOREHEAD_EXTRA];
      if (p[1] > cy + box.h * JAW_START) {
        // pull the jawline in toward the face centre to avoid chin/neck seams
        const cx = box.x + box.w / 2;
        const dx = cx - p[0];
        const dy = cy - p[1];
        const d = Math.hypot(dx, dy) || 1;
        return [p[0] + (dx / d) * C.FACE_JAW_ERODE * box.w, p[1] + (dy / d) * C.FACE_JAW_ERODE * box.w];
      }
      return p;
    });
    pts.push(...BROWS.map((i) => L[i]));
    return [{ poly: convexHull(pts), feather: box.w * C.FACE_FEATHER }];
  }
  return EYE_REGIONS.map((e) => {
    const eye = boxOf(e.contour.map((i) => L[i]));
    const down = eye.w * CHEEK_DROP;
    const pts = [
      ...e.contour.map((i) => L[i]),
      ...e.brow.map((i) => L[i]),
      ...e.lowerLid.map((i): Pt => [L[i][0], L[i][1] + down]),
    ];
    const hull = convexHull(pts);
    const hullBox = boxOf(hull);
    const grow = 1 + (2 * C.EYES_DILATE * eye.w) / Math.max(hullBox.w, 1);
    return { poly: scaleAboutCentroid(hull, grow), feather: eye.w * C.EYES_FEATHER };
  });
}

/** Skin-only region for colour statistics: the face shrunk inward, minus brows, eyes and mouth (very dark/bright features). */
export function skinPolygons(L: Pt[]): { include: Pt[]; exclude: Pt[][] } {
  const face = maskPolygons(L, 'face')[0].poly;
  const exclude = [
    ...EYE_REGIONS.map((e) =>
      scaleAboutCentroid(convexHull([...e.contour, ...e.brow].map((i) => L[i])), SKIN_EXCLUDE_EYES),
    ),
    scaleAboutCentroid(convexHull(LIPS.map((i) => L[i])), SKIN_EXCLUDE_LIPS),
  ];
  return { include: scaleAboutCentroid(face, SKIN_SHRINK), exclude };
}
