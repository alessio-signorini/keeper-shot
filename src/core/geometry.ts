import type { Box, Mat3, Pt } from '../types';

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function compose(a: Mat3, b: Mat3): Mat3 {
  // result = a · b (apply b first)
  const r = new Array(9).fill(0) as number[];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r as Mat3;
}

export function invert(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h,
    B = -(d * i - f * g),
    C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return [...IDENTITY];
  const s = 1 / det;
  return [
    A * s,
    -(b * i - c * h) * s,
    (b * f - c * e) * s,
    B * s,
    (a * i - c * g) * s,
    -(a * f - c * d) * s,
    C * s,
    -(a * h - b * g) * s,
    (a * e - b * d) * s,
  ];
}

export function apply(m: Mat3, p: Pt): Pt {
  const w = m[6] * p[0] + m[7] * p[1] + m[8];
  return [(m[0] * p[0] + m[1] * p[1] + m[2]) / w, (m[3] * p[0] + m[4] * p[1] + m[5]) / w];
}

export function applyAll(m: Mat3, pts: Pt[]): Pt[] {
  return pts.map((p) => apply(m, p));
}

export function scaleMat(sx: number, sy = sx): Mat3 {
  return [sx, 0, 0, 0, sy, 0, 0, 0, 1];
}

export function boxOf(pts: Pt[]): Box {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function iou(a: Box, b: Box): number {
  const x0 = Math.max(a.x, b.x),
    y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w),
    y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const u = a.w * a.h + b.w * b.h - inter;
  return u <= 0 ? 0 : inter / u;
}

export function center(b: Box): Pt {
  return [b.x + b.w / 2, b.y + b.h / 2];
}

/** Least-squares similarity (Umeyama, 2D): maps src → dst. Returns a 3x3 matrix and RMS residual. */
export function fitSimilarity(src: Pt[], dst: Pt[]): { m: Mat3; rms: number } {
  const n = src.length;
  let sx = 0,
    sy = 0,
    dx = 0,
    dy = 0;
  for (let i = 0; i < n; i++) {
    sx += src[i][0];
    sy += src[i][1];
    dx += dst[i][0];
    dy += dst[i][1];
  }
  sx /= n;
  sy /= n;
  dx /= n;
  dy /= n;
  let a = 0,
    b = 0,
    varS = 0;
  for (let i = 0; i < n; i++) {
    const px = src[i][0] - sx,
      py = src[i][1] - sy;
    const qx = dst[i][0] - dx,
      qy = dst[i][1] - dy;
    a += px * qx + py * qy;
    b += px * qy - py * qx;
    varS += px * px + py * py;
  }
  if (varS < 1e-12) return { m: [1, 0, dx - sx, 0, 1, dy - sy, 0, 0, 1], rms: Infinity };
  const c = a / varS,
    s = b / varS; // scale·cos, scale·sin
  const m: Mat3 = [c, -s, dx - (c * sx - s * sy), s, c, dy - (s * sx + c * sy), 0, 0, 1];
  let err = 0;
  for (let i = 0; i < n; i++) {
    const p = apply(m, src[i]);
    err += (p[0] - dst[i][0]) ** 2 + (p[1] - dst[i][1]) ** 2;
  }
  return { m, rms: Math.sqrt(err / n) };
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Box scaled by `k` about its centre, snapped outward to whole pixels and clipped to a W×H canvas. */
export function expandBox(b: Box, k: number, W: number, H: number): Box {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const w = b.w * k;
  const h = b.h * k;
  const x0 = Math.max(0, Math.floor(cx - w / 2));
  const y0 = Math.max(0, Math.floor(cy - h / 2));
  const x1 = Math.min(W, Math.ceil(cx + w / 2));
  const y1 = Math.min(H, Math.ceil(cy + h / 2));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Andrew's monotone chain; returns the hull counter-clockwise without repeating the first point. */
export function convexHull(points: Pt[]): Pt[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Points scaled by `factor` about their centroid. */
export function scaleAboutCentroid(pts: Pt[], factor: number): Pt[] {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return pts.map((p) => [cx + (p[0] - cx) * factor, cy + (p[1] - cy) * factor]);
}
