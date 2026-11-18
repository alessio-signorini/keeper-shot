import * as Comlink from 'comlink';
import * as C from '../config';
import { rebase, type PicksByPerson } from '../core/picks';
import { clearAll, loadSession, saveSession } from '../storage';
import type { FacePick, PipelineEvent } from '../types';
import { describeEvent } from './pipelineLog';
import { deliverFile } from './save';
import {
  detectedFaces,
  files,
  pipelineError,
  previewBitmap,
  progressLog,
  progressPercent,
  savedSession,
  saving,
  screen,
  session,
} from './store';
import { clearStoredUrls } from './useStoredUrl';
import { pipeline, recycleWorker, rendererFor } from './workerClient';

function onPipelineEvent(e: PipelineEvent) {
  const line = describeEvent(e);
  if (line) progressLog.value = [...progressLog.value, line];
  if (e.type === 'thumb') detectedFaces.value = [...detectedFaces.value, e];
  if (e.type === 'grouped') session.value = e.session;
  if (e.type === 'progress') progressPercent.value = Math.max(progressPercent.value, e.percent);
}

/** At startup: offer Resume if IndexedDB holds a finished session. */
export async function loadSavedSession() {
  try {
    const s = await loadSession();
    savedSession.value = s && s.baseFrameId && s.people.length ? s : null;
  } catch {
    savedSession.value = null;
  }
}

export async function startAnalysis() {
  const list = files.value;
  pipelineError.value = null;
  progressLog.value = [];
  detectedFaces.value = [];
  progressPercent.value = 0;
  session.value = null;
  screen.value = 'progress';
  clearStoredUrls();
  void navigator.storage?.persist?.();
  try {
    const s = await pipeline().analyzeBurst(
      list.map((f) => ({ name: f.name, blob: f })),
      Comlink.proxy(onPipelineEvent),
    );
    recycleWorker();
    session.value = s;
    await refreshPreview();
    progressPercent.value = 100;
    await new Promise((r) => setTimeout(r, C.AUTO_ADVANCE_MS));
    screen.value = 'review';
  } catch (err) {
    pipelineError.value = (err as Error).message || String(err);
  }
}

export async function resumeSession() {
  const s = savedSession.value;
  if (!s) return;
  session.value = s;
  screen.value = 'review';
  await refreshPreview();
}

export async function startOver() {
  await clearAll();
  clearStoredUrls();
  savedSession.value = null;
  session.value = null;
  files.value = [];
  previewBitmap.value?.close();
  previewBitmap.value = null;
  screen.value = 'upload';
}

let previewSeq = 0;
/** Re-render the preview; `draftPicks` previews unconfirmed face-sheet choices without saving them. */
export async function refreshPreview(draftPicks?: PicksByPerson) {
  const s = session.value;
  if (!s) return;
  const seq = ++previewSeq;
  const bmp = await (await rendererFor(s)).renderPreview(s.baseFrameId, draftPicks ?? s.picks, C.PREVIEW_LONG_EDGE);
  if (seq !== previewSeq) return bmp.close();
  previewBitmap.value?.close();
  previewBitmap.value = bmp;
}

export async function setPick(pick: FacePick) {
  const s = session.value!;
  session.value = { ...s, picks: { ...s.picks, [pick.personId]: pick } };
  await saveSession(session.value);
  await refreshPreview();
}

export async function setBase(frameId: string) {
  const s = session.value!;
  const picks = rebase(frameId, s.people, s.faces, s.picks);
  session.value = { ...s, baseFrameId: frameId, picks };
  await saveSession(session.value);
  await refreshPreview();
}

/** The untouched base frame at preview size (before/after). */
export async function renderOriginalBase(): Promise<ImageBitmap> {
  const s = session.value!;
  return (await rendererFor(s)).renderFrame(s.baseFrameId, C.PREVIEW_LONG_EDGE);
}

export async function saveComposite(mode: 'auto' | 'download' = 'auto') {
  const s = session.value!;
  saving.value = true;
  try {
    const { blob, name } = await (await rendererFor(s)).exportJpeg(s.baseFrameId, s.picks);
    await deliverFile(blob, name, mode);
  } finally {
    saving.value = false;
  }
}
