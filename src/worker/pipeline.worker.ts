import * as Comlink from 'comlink';
import exifr from 'exifr';
import * as C from '../config';
import { applyAll, boxOf, iou } from '../core/geometry';
import { alignByFaces, scoreAlignment } from '../core/faceAlign';
import { groupFaces } from '../core/group';
import { dropBlurryPeople, dropSmallOutliers } from '../core/faceFilters';
import { searchRegion } from '../core/tiles';
import { estimateJpegQuality } from '../core/jpegQuality';
import { eyesScore, funnyPenalty, normalizeSharpness, scoreFace } from '../core/score';
import { chooseBase, isSwap } from '../core/select';
import { fthumbKey, frameKey, getBlob, putBlob, saveSession, thumbKey, clearAll } from '../db';
import type { Box, Face, Frame, Pick, PipelineEvent, Session } from '../types';
import { Aligner, maskBoxes, toGray, type AlignFeatures } from './align';
import { Compositor, renderComposite } from './composite';
import { installImportScripts, loadCV } from './cv';
import { decodeBlob, fitSize, scaledCanvas } from './decode';
import { closeDetector, detectFaces, faceThumb, initDetector, refineFace, sharpnessOf, type RawFace } from './detect';
import { encodeJpeg, exportName } from './encode';

installImportScripts();
let baseUrl = '/';
type Emit = (e: PipelineEvent) => void;

interface Meta { file: { name: string; blob: Blob }; exif: Record<string, unknown>; time: number; quality: number }

function jsonSafe(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v instanceof Date) out[k] = v.toISOString();
    else if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') out[k] = v;
    else if (Array.isArray(v) && v.every((x) => typeof x === 'number') && v.length < 16) out[k] = v;
  }
  return out;
}

async function readMeta(file: { name: string; blob: Blob }, order: number): Promise<Meta> {
  let exif: Record<string, unknown> = {};
  try {
    exif = (await exifr.parse(file.blob, true)) ?? {};
  } catch { /* no EXIF */ }
  const dt = exif.DateTimeOriginal;
  const sub = Number(exif.SubSecTimeOriginal ?? 0) / 1000 || 0;
  const time = dt instanceof Date ? dt.getTime() + sub * 1000 : order;
  const head = new Uint8Array(await file.blob.slice(0, 256 * 1024).arrayBuffer());
  const quality = head[0] === 0xff && head[1] === 0xd8 ? estimateJpegQuality(head) : C.JPEG_QUALITY_FALLBACK;
  return { file, exif: jsonSafe(exif), time: dt instanceof Date ? time : Number.MAX_SAFE_INTEGER / 2 + order, quality };
}

const blankScore = { eyes: 0, gaze: 0, pose: 0, smile: 0, sharp: 0, total: 0 };

async function run(files: { name: string; blob: Blob }[], emit: Emit): Promise<Session> {
  comp = null;
  await clearAll();
  await initDetector(baseUrl);
  const metas: Meta[] = [];
  for (let i = 0; i < files.length; i++) metas.push(await readMeta(files[i], i));
  metas.sort((a, b) => a.time - b.time);
  const n = metas.length;

  const frames: Frame[] = metas.map((m, i) => ({
    id: `f${i}`, name: m.file.name, blobKey: frameKey(`f${i}`), width: 0, height: 0,
    toRef: [1, 0, 0, 0, 1, 0, 0, 0, 1], alignInliers: 0, exif: m.exif, jpegQuality: m.quality,
  }));
  const faces: Record<string, Face> = {};
  const feats: AlignFeatures[] = [];

  // Pass 1 — decode + detect, one full-res bitmap at a time
  let prevBoxes: Box[] = [];
  for (let i = 0; i < n; i++) {
    const frame = frames[i];
    await putBlob(frame.blobKey, metas[i].file.blob);
    const bmp = await decodeBlob(metas[i].file.blob, baseUrl);
    try {
      frame.width = bmp.width;
      frame.height = bmp.height;
      if (i === 0) emit({ type: 'loaded', count: n, megapixels: Math.round((bmp.width * bmp.height) / 1e5) / 10 });
      const work = fitSize(bmp.width, bmp.height, C.WORK_LONG_EDGE);
      const canvas = scaledCanvas(bmp, work.w, work.h);
      const candidates = await detectFaces(canvas, searchRegion(prevBoxes, work.w, work.h));
      const up = 1 / work.s;
      const raw: RawFace[] = [];
      for (const c of candidates) {
        const full = { x: c.box.x * up, y: c.box.y * up, w: c.box.w * up, h: c.box.h * up };
        const r = await refineFace(bmp, full);
        if (r && !raw.some((q) => iou(q.box, r.box) > C.TILE_MERGE_IOU)) raw.push(r);
      }
      raw.splice(0, raw.length, ...dropSmallOutliers(raw));
      raw.sort((a, b) => a.box.x - b.box.x);
      prevBoxes = raw.map((r) => ({ x: r.box.x * work.s, y: r.box.y * work.s, w: r.box.w * work.s, h: r.box.h * work.s }));
      const ids: string[] = [];
      for (let k = 0; k < raw.length; k++) {
        const r = raw[k];
        const id = `${frame.id}:${k}`;
        const box = r.box;
        faces[id] = {
          id, frameId: frame.id, landmarks: r.landmarks, refLandmarks: r.landmarks, box, refBox: box,
          blend: r.blend, pose: r.pose, sharpness: sharpnessOf(bmp, box), score: { ...blankScore }, thumbKey: thumbKey(id),
        };
        ids.push(id);
        await putBlob(thumbKey(id), await faceThumb(bmp, box));
        const sc = scoreFace(r.blend, r.pose, 1);
        emit({ type: 'thumb', faceId: id, frameId: frame.id, blink: sc.eyes < C.BLINK_THRESHOLD, away: sc.gaze < 0.5 || sc.pose < 0.4, funny: funnyPenalty(r.blend) > 0 });
      }
      const ft = fitSize(bmp.width, bmp.height, C.THUMB_PX);
      await putBlob(fthumbKey(frame.id), await scaledCanvas(bmp, ft.w, ft.h).convertToBlob({ type: 'image/jpeg', quality: C.THUMB_QUALITY }));
      emit({ type: 'detected', frame: i + 1, total: n, faces: ids.length });
      const a = fitSize(bmp.width, bmp.height, C.ALIGN_LONG_EDGE);
      const ac = scaledCanvas(bmp, a.w, a.h);
      feats.push({ w: a.w, h: a.h, gray: toGray(ac), masks: maskBoxes(ids.map((id) => faces[id].box), a.s) });
    } finally {
      bmp.close();
    }
    emit({ type: 'progress', percent: ((C.PROGRESS.decode + C.PROGRESS.detect) * (i + 1)) / n });
  }
  closeDetector();
  const session: Session = { frames, faces, people: [], refFrameId: '', baseFrameId: '', picks: {} };
  await saveSession(session);

  // Pass 2 — align every frame to the middle frame
  const refIdx = Math.floor(n / 2);
  session.refFrameId = frames[refIdx].id;
  const alignBase = C.PROGRESS.decode + C.PROGRESS.detect;
  const orb = new Map<number, { fallback: boolean }>();
  try {
    const aligner = await Aligner.create(baseUrl, feats[refIdx]);
    try {
      for (let i = 0; i < n; i++) {
        if (i !== refIdx) {
          const r = await aligner.align(feats[i], frames[i].width);
          frames[i].toRef = r.toRefFull;
          frames[i].alignInliers = r.inliers;
          frames[i].matches = r.matches;
          orb.set(i, { fallback: r.fallback || r.identity });
        }
        emit({ type: 'progress', percent: alignBase + (C.PROGRESS.align * (i + 1)) / n });
      }
    } finally {
      aligner.dispose();
    }
  } catch (err) {
    emit({ type: 'warn', message: `Background alignment unavailable (${(err as Error).message})` });
  }

  // The background can align differently from the people (parallax, featureless grass): keep whichever transform
  // lines up more of the group's faces with the reference frame.
  const refFaces = Object.values(faces).filter((f) => f.frameId === frames[refIdx].id);
  for (let i = 0; i < n; i++) {
    if (i === refIdx) continue;
    const mine = Object.values(faces).filter((f) => f.frameId === frames[i].id);
    const current = scoreAlignment(frames[i].toRef, mine, refFaces);
    const byFaces = alignByFaces(mine, refFaces, frames[i].toRef);
    const better = byFaces && (byFaces.matched > current.matched || (byFaces.matched === current.matched && byFaces.err < current.err));
    if (better) {
      frames[i].toRef = byFaces.m;
      frames[i].alignMethod = 'faces';
      emit({ type: 'aligned', frame: i + 1, total: n, inliers: frames[i].alignInliers, byFaces: { matched: byFaces.matched, of: mine.length } });
    } else {
      frames[i].alignMethod = 'orb';
      if (!orb.has(i)) emit({ type: 'warn', message: `Photo ${i + 1}: could not align, using identity` });
      else emit({ type: 'aligned', frame: i + 1, total: n, inliers: frames[i].alignInliers, fallback: orb.get(i)!.fallback });
    }
  }
  frames[refIdx].alignInliers = Math.max(0, ...frames.map((f) => f.alignInliers)) + 1;
  for (const f of Object.values(faces)) {
    const fr = frames.find((x) => x.id === f.frameId)!;
    f.refLandmarks = applyAll(fr.toRef, f.landmarks);
    f.refBox = boxOf(f.refLandmarks);
  }
  await saveSession(session);

  // Group, score, pick
  const people = dropBlurryPeople(groupFaces(frames, faces), faces);
  const keep = new Set(people.flatMap((p) => Object.values(p.faces)));
  for (const id of Object.keys(faces)) if (!keep.has(id)) delete faces[id];
  for (const p of people) {
    const ids = Object.values(p.faces);
    const norm = normalizeSharpness(ids.map((id) => faces[id].sharpness));
    const eyesRef = Math.max(...ids.map((id) => eyesScore(faces[id].blend)));
    ids.forEach((id, i) => (faces[id].score = scoreFace(faces[id].blend, faces[id].pose, norm[i], eyesRef)));
  }
  session.people = people;
  const best = chooseBase(frames, people, faces);
  session.baseFrameId = best.frameId;
  session.picks = best.picks;
  await saveSession(session);
  emit({ type: 'grouped', people: people.length, frames: n, session });
  emit({ type: 'base', frame: frames.findIndex((f) => f.id === best.frameId) + 1, swaps: best.swaps });
  emit({ type: 'progress', percent: alignBase + C.PROGRESS.align + C.PROGRESS.group });
  return session;
}

// ---- rendering ----------------------------------------------------------------------------

const cache = new Map<string, ImageBitmap>();
const CACHE_MAX = 6;
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const p = queue.then(fn, fn);
  queue = p.catch(() => undefined);
  return p;
};

async function frameBlob(frame: Frame): Promise<Blob> {
  const b = await getBlob(frame.blobKey);
  if (!b) throw new Error(`Missing stored photo ${frame.name}`);
  return b;
}

async function scaledBitmap(frame: Frame, scale: number): Promise<ImageBitmap> {
  const blob = await frameBlob(frame);
  if (scale < 1) {
    // decoding straight to the target size avoids ever holding the 80MB full-resolution bitmap
    try {
      const w = Math.round(frame.width * scale), h = Math.round(frame.height * scale);
      return await createImageBitmap(blob, { imageOrientation: 'from-image', resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
    } catch { /* e.g. HEIC: fall back to the full decode below */ }
  }
  const full = await decodeBlob(blob, baseUrl);
  if (scale >= 1) return full;
  try {
    return await createImageBitmap(scaledCanvas(full, Math.round(full.width * scale), Math.round(full.height * scale)));
  } finally {
    full.close();
  }
}

async function cached(frame: Frame, scale: number): Promise<ImageBitmap> {
  const key = `${frame.id}@${scale.toFixed(4)}`;
  let b = cache.get(key);
  if (b) {
    cache.delete(key);
    cache.set(key, b);
    return b;
  }
  b = await scaledBitmap(frame, scale);
  cache.set(key, b);
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value!;
    cache.get(oldest)!.close();
    cache.delete(oldest);
  }
  return b;
}

const previewScale = (f: Frame, longEdge: number) => Math.min(1, longEdge / Math.max(f.width, f.height));

let comp: Compositor | null = null;

async function preview(session: Session, picks: Record<string, Pick>, longEdge: number): Promise<ImageBitmap> {
  const frames = new Map(session.frames.map((f) => [f.id, f]));
  const base = frames.get(session.baseFrameId)!;
  const scale = previewScale(base, longEdge);
  if (!comp || comp.baseId !== base.id || comp.scale !== scale) {
    comp = new Compositor(base.id, scale, await cached(base, scale), true);
  }
  const cv = Object.values(picks).some(isSwap) ? await loadCV(baseUrl) : null;
  await comp.update(session, picks, { cv, source: (id) => cached(frames.get(id)!, scale) });
  return createImageBitmap(comp.canvas);
}

async function exportFull(session: Session, picks: Record<string, Pick>): Promise<{ blob: Blob; name: string }> {
  // free the preview's bitmaps and canvas: the full-resolution render needs the memory
  for (const b of cache.values()) b.close();
  cache.clear();
  comp = null;
  const frames = new Map(session.frames.map((f) => [f.id, f]));
  const base = frames.get(session.baseFrameId)!;
  const baseBmp = await scaledBitmap(base, 1);
  try {
    const cv = await loadCV(baseUrl);
    const canvas = await renderComposite(session, picks, {
      cv, scale: 1, base: baseBmp,
      source: (id) => scaledBitmap(frames.get(id)!, 1),
      release: (_id, b) => b.close(),
      releaseBase: () => baseBmp.close(),
    });
    const blob = await encodeJpeg(canvas, base, await frameBlob(base));
    return { blob, name: exportName(base.name) };
  } finally {
    baseBmp.close();
  }
}

const api = {
  init(url: string) { baseUrl = url; },
  run: (files: { name: string; blob: Blob }[], emit: Emit) => run(files, emit),
  preview: (session: Session, picks: Record<string, Pick>, longEdge: number) =>
    serial(async () => {
      const b = await preview(session, picks, longEdge);
      return Comlink.transfer(b, [b]);
    }),
  plain: (session: Session, frameId: string, longEdge: number) =>
    serial(async () => {
      const f = session.frames.find((x) => x.id === frameId)!;
      const b = await createImageBitmap(await cached(f, previewScale(f, longEdge)));
      return Comlink.transfer(b, [b]);
    }),
  exportJpeg: (session: Session, picks: Record<string, Pick>) => serial(() => exportFull(session, picks)),
};

export type PipelineApi = typeof api;
Comlink.expose(api);