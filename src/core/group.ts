import * as C from '../config';
import type { Box, Face, Frame, Person } from '../types';
import { center, iou } from './geometry';

/** Hungarian algorithm (min cost) for a rectangular matrix. Returns assignment[row] = col or -1. */
export function hungarian(cost: number[][]): number[] {
  const rows = cost.length;
  if (!rows) return [];
  const cols = cost[0].length;
  const n = Math.max(rows, cols);
  const a: number[][] = Array.from({ length: n + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i >= 1 && j >= 1 && i <= rows && j <= cols ? cost[i - 1][j - 1] : 0)),
  );
  const u = new Array(n + 1).fill(0),
    v = new Array(n + 1).fill(0);
  const p = new Array(n + 1).fill(0),
    way = new Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(n + 1).fill(Infinity);
    const used = new Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity,
        j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = a[i0][j] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const res = new Array(rows).fill(-1);
  for (let j = 1; j <= n; j++) if (p[j] >= 1 && p[j] <= rows && j <= cols) res[p[j] - 1] = j - 1;
  return res;
}

interface Cluster {
  faces: Record<string, string>;
  boxes: Box[];
}

function meanBox(bs: Box[]): Box {
  const n = bs.length;
  return {
    x: bs.reduce((s, b) => s + b.x, 0) / n,
    y: bs.reduce((s, b) => s + b.y, 0) / n,
    w: bs.reduce((s, b) => s + b.w, 0) / n,
    h: bs.reduce((s, b) => s + b.h, 0) / n,
  };
}

/**
 * A person who moved between frames leaves one fragment per resting place. Fragments never sharing a frame can be the
 * same person; merge the closest such pair while the distance stays within what the frame gap allows.
 */
function mergeFragments(clusters: Cluster[], order: string[]): void {
  const idx = new Map(order.map((id, i) => [id, i]));
  const span = (c: Cluster) => {
    const ix = Object.keys(c.faces).map((k) => idx.get(k)!);
    return { lo: Math.min(...ix), hi: Math.max(...ix) };
  };
  for (;;) {
    let best: { a: number; b: number; score: number } | null = null;
    for (let a = 0; a < clusters.length; a++) {
      for (let b = a + 1; b < clusters.length; b++) {
        if (Object.keys(clusters[a].faces).some((k) => k in clusters[b].faces)) continue;
        const sa = span(clusters[a]),
          sb = span(clusters[b]);
        const gap = sa.hi < sb.lo ? sb.lo - sa.hi : sb.hi < sa.lo ? sa.lo - sb.hi : 1; // interleaved: treat as adjacent
        const ma = meanBox(clusters[a].boxes),
          mb = meanBox(clusters[b].boxes);
        const d = Math.hypot(center(ma)[0] - center(mb)[0], center(ma)[1] - center(mb)[1]) / Math.max(ma.w, mb.w, 1);
        const limit = C.GROUP_MERGE_BASE + C.GROUP_MERGE_PER_FRAME * gap;
        if (d <= limit && (!best || d / limit < best.score)) best = { a, b, score: d / limit };
      }
    }
    if (!best) return;
    const keep = clusters[best.a],
      gone = clusters[best.b];
    Object.assign(keep.faces, gone.faces);
    keep.boxes.push(...gone.boxes);
    clusters.splice(best.b, 1);
  }
}

/** Cluster faces (in reference coords) into people across frames. */
export function groupFaces(frames: Pick<Frame, 'id'>[], faces: Record<string, Face>): Person[] {
  const byFrame = new Map<string, Face[]>();
  for (const f of frames) byFrame.set(f.id, []);
  for (const f of Object.values(faces)) byFrame.get(f.frameId)?.push(f);

  let seedId = frames[0]?.id;
  let most = -1;
  for (const f of frames) {
    const n = byFrame.get(f.id)!.length;
    if (n > most) {
      most = n;
      seedId = f.id;
    }
  }
  if (seedId === undefined) return [];

  const clusters: Cluster[] = byFrame.get(seedId)!.map((f) => ({ faces: { [f.frameId]: f.id }, boxes: [f.refBox] }));
  for (const fr of frames) {
    if (fr.id === seedId) continue;
    const fs = byFrame.get(fr.id)!;
    if (!fs.length) continue;
    const means = clusters.map((c) => meanBox(c.boxes));
    const cost = fs.map((f) =>
      means.map((m) => {
        const d = Math.hypot(...(center(f.refBox).map((v, i) => v - center(m)[i]) as [number, number]));
        const norm = d / Math.max(f.refBox.w, m.w, 1);
        return 1 - iou(f.refBox, m) + C.GROUP_CENTER_WEIGHT * Math.min(norm, 2);
      }),
    );
    const assign = clusters.length ? hungarian(cost) : fs.map(() => -1);
    fs.forEach((f, i) => {
      const j = assign[i];
      const near =
        j >= 0 &&
        Math.hypot(center(f.refBox)[0] - center(means[j])[0], center(f.refBox)[1] - center(means[j])[1]) <=
          C.GROUP_MAX_DIST * Math.max(f.refBox.w, means[j].w);
      if (j >= 0 && (iou(f.refBox, means[j]) >= C.GROUP_MIN_IOU || near)) {
        clusters[j].faces[fr.id] = f.id;
        clusters[j].boxes.push(f.refBox);
      } else {
        clusters.push({ faces: { [fr.id]: f.id }, boxes: [f.refBox] });
      }
    });
  }

  mergeFragments(
    clusters,
    frames.map((f) => f.id),
  );

  const minFrames = Math.max(1, Math.ceil(frames.length * C.GROUP_MIN_FRAME_FRACTION));
  return clusters
    .filter((c) => Object.keys(c.faces).length >= minFrames)
    .map((c) => ({ c, x: meanBox(c.boxes).x + meanBox(c.boxes).w / 2 }))
    .sort((a, b) => a.x - b.x)
    .map(({ c }, i) => ({ id: `p${i + 1}`, faces: c.faces }));
}
