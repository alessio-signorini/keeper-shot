import { computed, signal } from '@preact/signals';
import { needsAttention, isSwap, rebase } from '../core/picks';
import type { PipelineEvent, Session } from '../types';

// Main-thread app state. Mutated only through ./actions.ts; components read signals directly.

export type Screen = 'upload' | 'progress' | 'review';
export type DetectedFaceEvent = Extract<PipelineEvent, { type: 'thumb' }>;

export const screen = signal<Screen>('upload');
/** photos chosen on the upload screen */
export const files = signal<File[]>([]);
export const session = signal<Session | null>(null);
/** a resumable session found in IndexedDB at startup */
export const savedSession = signal<Session | null>(null);

// progress screen
export const progressPercent = signal(0);
export const progressLog = signal<string[]>([]);
export const pipelineError = signal<string | null>(null);
export const detectedFaces = signal<DetectedFaceEvent[]>([]);
export const counters = computed(() => ({
  faces: detectedFaces.value.length,
  blinks: detectedFaces.value.filter((t) => t.blink).length,
  away: detectedFaces.value.filter((t) => t.away).length,
  funny: detectedFaces.value.filter((t) => t.funny).length,
}));

// review screen
export const previewBitmap = signal<ImageBitmap | null>(null);
/** press-and-hold: show the untouched base frame */
export const showingOriginal = signal(false);
export const saving = signal(false);

/** People whose face needs checking (amber), in person order. */
export const attentionPersonIds = computed(() => {
  const s = session.value;
  if (!s) return [];
  return s.people.filter((p) => needsAttention(p, s.picks[p.id], s.faces, s.frames.length)).map((p) => p.id);
});

/** Swaps each frame would need as the base (keeping still-feasible manual picks), for the base strip. */
export const swapCountByFrame = computed(() => {
  const s = session.value;
  const counts = new Map<string, number>();
  if (!s) return counts;
  for (const f of s.frames) {
    counts.set(f.id, Object.values(rebase(f.id, s.people, s.faces, s.picks)).filter(isSwap).length);
  }
  return counts;
});
