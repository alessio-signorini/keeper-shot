import * as Comlink from 'comlink';
import * as C from '../config';
import { analyzePeople } from '../core/analyze';
import { misalignedFrames } from '../core/faceAlignment';
import type { PicksByPerson } from '../core/picks';
import { clearAll, saveSession } from '../storage';
import type { PipelineEvent, Session } from '../types';
import { installImportScripts } from './lib/opencv';
import { Renderer } from './render/renderer';
import { alignPass } from './stages/alignPass';
import { detectPass } from './stages/detectPass';
import { ingestFiles, newFrame, type InputFile } from './stages/ingest';

installImportScripts();

/** Where the app's static assets (models, wasm) are served from; set by `init`. */
let baseUrl = '/';
const renderer = new Renderer(() => baseUrl);

type Emit = (e: PipelineEvent) => void;

/** Analyse a burst end to end. Stores originals, thumbnails and the session in IndexedDB as it goes. */
async function analyzeBurst(files: InputFile[], emit: Emit): Promise<Session> {
  renderer.reset();
  await clearAll();
  const infos = await ingestFiles(files);
  const frames = infos.map(newFrame);
  const n = frames.length;
  const detectSpan = C.PROGRESS.decode + C.PROGRESS.detect;

  const { faces, alignFeatures } = await detectPass(frames, infos, baseUrl, emit, detectSpan);
  const session: Session = { frames, faces, people: [], refFrameId: '', baseFrameId: '', picks: {} };
  await saveSession(session);

  const refIndex = Math.floor(n / 2);
  session.refFrameId = frames[refIndex].id;
  await alignPass(frames, faces, alignFeatures, refIndex, baseUrl, emit, { from: detectSpan, span: C.PROGRESS.align });
  await saveSession(session);

  const drop = misalignedFrames(frames, faces, session.refFrameId);
  for (const f of frames) {
    if (drop.has(f.id)) emit({ type: 'warn', message: `Photo ${f.name} left out: people moved too much to line up` });
  }
  session.frames = frames.filter((f) => !drop.has(f.id));
  const alignedFaces = Object.fromEntries(Object.entries(faces).filter(([, f]) => !drop.has(f.frameId)));

  const analysis = analyzePeople(session.frames, alignedFaces, session.refFrameId);
  session.faces = analysis.faces;
  session.people = analysis.people;
  session.baseFrameId = analysis.base.frameId;
  session.picks = analysis.base.picks;
  await saveSession(session);
  emit({ type: 'grouped', people: session.people.length, frames: session.frames.length, session });
  const baseNumber = session.frames.findIndex((f) => f.id === session.baseFrameId) + 1;
  emit({ type: 'base', frame: baseNumber, swaps: analysis.base.swaps });
  emit({ type: 'progress', percent: detectSpan + C.PROGRESS.align + C.PROGRESS.group });
  return session;
}

// Rendering calls run one at a time: each can hold large bitmaps, and the preview compositor is stateful.
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const p = queue.then(fn, fn);
  queue = p.catch(() => undefined);
  return p;
};

const api = {
  init(url: string) {
    baseUrl = url;
  },
  analyzeBurst: (files: InputFile[], emit: Emit) => analyzeBurst(files, emit),
  renderPreview: (session: Session, picks: PicksByPerson, longEdge: number) =>
    serial(async () => {
      const b = await renderer.renderPreview(session, picks, longEdge);
      return Comlink.transfer(b, [b]);
    }),
  renderFrame: (session: Session, frameId: string, longEdge: number) =>
    serial(async () => {
      const b = await renderer.renderFrame(session, frameId, longEdge);
      return Comlink.transfer(b, [b]);
    }),
  exportJpeg: (session: Session, picks: PicksByPerson) => serial(() => renderer.exportJpeg(session, picks)),
};

export type PipelineApi = typeof api;
Comlink.expose(api);
