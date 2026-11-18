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

/**
 * The analysed session (frames, faces, people) the render calls work on. Sent once per worker by the main thread so
 * that pick and base changes only send `baseFrameId` + picks instead of every face's landmarks.
 */
let loaded: Session | null = null;

function loadedSession(): Session {
  if (!loaded) throw new Error('No session loaded in the pipeline worker');
  return loaded;
}

const withChoice = (baseFrameId: string, picks: PicksByPerson): Session => ({ ...loadedSession(), baseFrameId, picks });

const api = {
  init(url: string) {
    baseUrl = url;
  },
  analyzeBurst: async (files: InputFile[], emit: Emit) => {
    loaded = null;
    loaded = await analyzeBurst(files, emit);
    return loaded;
  },
  /** Replaces the analysed session the render calls use; its baseFrameId and picks are ignored. */
  setSession(session: Session) {
    loaded = session;
    renderer.reset();
  },
  renderPreview: (baseFrameId: string, picks: PicksByPerson, longEdge: number) =>
    serial(async () => {
      const b = await renderer.renderPreview(withChoice(baseFrameId, picks), picks, longEdge);
      return Comlink.transfer(b, [b]);
    }),
  renderFrame: (frameId: string, longEdge: number) =>
    serial(async () => {
      const b = await renderer.renderFrame(loadedSession(), frameId, longEdge);
      return Comlink.transfer(b, [b]);
    }),
  exportJpeg: (baseFrameId: string, picks: PicksByPerson) =>
    serial(() => renderer.exportJpeg(withChoice(baseFrameId, picks), picks)),
};

export type PipelineApi = typeof api;
Comlink.expose(api);
