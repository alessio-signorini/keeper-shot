import * as Comlink from 'comlink';
import { signal, computed } from '@preact/signals';
import * as C from './config';
import { rebase, needsAttention } from './core/select';
import { clearAll, loadSession, saveSession } from './db';
import { clearStoredUrls } from './ui/useStored';
import type { Pick, PipelineEvent, Session } from './types';
import type { PipelineApi } from './worker/pipeline.worker';

export type Screen = 'upload' | 'progress' | 'review';

export const screen = signal<Screen>('upload');
export const files = signal<File[]>([]);
export const session = signal<Session | null>(null);
export const savedSession = signal<Session | null>(null);
export const percent = signal(0);
export const feed = signal<string[]>([]);
export const error = signal<string | null>(null);
export const thumbs = signal<{ faceId: string; frameId: string; blink: boolean; away: boolean; funny: boolean }[]>([]);
export const counters = computed(() => ({
  faces: thumbs.value.length,
  blinks: thumbs.value.filter((t) => t.blink).length,
  away: thumbs.value.filter((t) => t.away).length,
  funny: thumbs.value.filter((t) => t.funny).length,
}));
export const previewBitmap = signal<ImageBitmap | null>(null);
export const comparing = signal(false);
export const saving = signal(false);

let worker: Worker | null = null;
let api: Comlink.Remote<PipelineApi> | null = null;

export function getApi(): Comlink.Remote<PipelineApi> {
  if (!api) {
    worker = new Worker(new URL('./worker/pipeline.worker.ts', import.meta.url), { type: 'module' });
    api = Comlink.wrap<PipelineApi>(worker);
    void api.init(new URL(import.meta.env.BASE_URL, location.href).href);
  }
  return api;
}

const log = (m: string) => (feed.value = [...feed.value, m]);

function onEvent(e: PipelineEvent) {
  switch (e.type) {
    case 'loaded': log(`Loaded ${e.count} photos (${e.megapixels} MP each)`); break;
    case 'detected': log(`Photo ${e.frame}/${e.total}: found ${e.faces} faces`); break;
    case 'thumb': thumbs.value = [...thumbs.value, e]; break;
    case 'aligned': log(`Aligned photo ${e.frame} — ${e.inliers} matching points${e.fallback ? ' (fallback)' : ''}`); break;
    case 'grouped': log(`Grouped ${e.people} people across ${e.frames} photos`); session.value = e.session; break;
    case 'base': log(`Best base: photo ${e.frame} — needs ${e.swaps} fix${e.swaps === 1 ? '' : 'es'}`); break;
    case 'warn': log(`⚠ ${e.message}`); break;
    case 'progress': percent.value = Math.max(percent.value, e.percent); break;
  }
}

export async function loadSaved() {
  try {
    const s = await loadSession();
    savedSession.value = s && s.baseFrameId && s.people.length ? s : null;
  } catch {
    savedSession.value = null;
  }
}

export async function start() {
  const list = files.value;
  error.value = null;
  feed.value = [];
  thumbs.value = [];
  percent.value = 0;
  session.value = null;
  screen.value = 'progress';
  clearStoredUrls();
  void navigator.storage?.persist?.();
  try {
    const s = await getApi().run(
      list.map((f) => ({ name: f.name, blob: f })),
      Comlink.proxy(onEvent),
    );
    session.value = s;
    await refreshPreview();
    percent.value = 100;
    await new Promise((r) => setTimeout(r, C.AUTO_ADVANCE_MS));
    screen.value = 'review';
  } catch (err) {
    error.value = (err as Error).message || String(err);
  }
}

export async function resume() {
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
export async function refreshPreview(overridePicks?: Record<string, Pick>) {
  const s = session.value;
  if (!s) return;
  const seq = ++previewSeq;
  const bmp = await getApi().preview(s, overridePicks ?? s.picks, C.PREVIEW_LONG_EDGE);
  if (seq !== previewSeq) return bmp.close();
  previewBitmap.value?.close();
  previewBitmap.value = bmp;
}

export async function setPick(pick: Pick) {
  const s = session.value!;
  session.value = { ...s, picks: { ...s.picks, [pick.personId]: pick } };
  await saveSession(session.value);
  await refreshPreview();
}

export async function setBase(frameId: string) {
  const s = session.value!;
  const frame = s.frames.find((f) => f.id === frameId)!;
  const picks = rebase(frame, s.people, s.faces, s.picks);
  session.value = { ...s, baseFrameId: frameId, picks };
  await saveSession(session.value);
  await refreshPreview();
}

export function swapCount(s: Session, frameId: string): number {
  const f = s.frames.find((x) => x.id === frameId)!;
  return Object.values(rebase(f, s.people, s.faces, s.picks)).filter((p) => p.mode !== 'base').length;
}

export function attentionPeople(s: Session): string[] {
  return s.people.filter((p) => needsAttention(p, s.picks[p.id], s.faces)).map((p) => p.id);
}

export async function plainBase(): Promise<ImageBitmap> {
  const s = session.value!;
  return getApi().plain(s, s.baseFrameId, C.PREVIEW_LONG_EDGE);
}

export async function saveResult() {
  const s = session.value!;
  saving.value = true;
  try {
    const { blob, name } = await getApi().exportJpeg(s, s.picks);
    const file = new File([blob], name, { type: 'image/jpeg' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return;
      } catch (err) {
        if ((err as DOMException).name === 'AbortError') return;
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } finally {
    saving.value = false;
  }
}
