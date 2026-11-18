import * as C from '../config';
import type { Box, Face, Frame, Person } from '../types';
import { center, dist, iou } from './geometry';
import { hungarian } from './hungarian';
import { median } from './stats';

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
        const d = dist(center(ma), center(mb)) / Math.max(ma.w, mb.w, 1);
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
        const d = dist(center(f.refBox), center(m));
        const norm = d / Math.max(f.refBox.w, m.w, 1);
        return 1 - iou(f.refBox, m) + C.GROUP_CENTER_WEIGHT * Math.min(norm, 2);
      }),
    );
    const assign = clusters.length ? hungarian(cost) : fs.map(() => -1);
    fs.forEach((f, i) => {
      const j = assign[i];
      const near =
        j >= 0 && dist(center(f.refBox), center(means[j])) <= C.GROUP_MAX_DIST * Math.max(f.refBox.w, means[j].w);
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

/** Drop people whose faces are far blurrier than everyone else's: out-of-focus background that looked like a face. */
export function dropBlurryPeople(people: Person[], faces: Record<string, Face>): Person[] {
  if (people.length < C.MIN_REL_FACE_COUNT) return people;
  const sharp = people.map((p) => median(Object.values(p.faces).map((id) => faces[id].sharpness)));
  const floor = median(sharp) * C.MIN_REL_SHARPNESS;
  return people.filter((_, i) => sharp[i] >= floor);
}
