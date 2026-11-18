import { clear, get, set } from 'idb-keyval';
import type { Session } from './types';

// Everything persisted in IndexedDB (idb-keyval's default store). Shared by the worker and the main thread.

const SESSION_KEY = 'session';
/** original photo blob */
export const frameBlobKey = (frameId: string) => `frame:${frameId}`;
/** small JPEG of a whole frame (base strip) */
export const frameThumbKey = (frameId: string) => `fthumb:${frameId}`;
/** small JPEG crop of one face */
export const faceThumbKey = (faceId: string) => `thumb:${faceId}`;

export const saveSession = (s: Session) => set(SESSION_KEY, s);
export const loadSession = () => get<Session>(SESSION_KEY);
/** Bytes + type rather than a Blob: some WebKit browsers (Vivaldi on iOS) hang when a Blob is written to IndexedDB. */
interface StoredBlob {
  type: string;
  bytes: ArrayBuffer;
}
export const putBlob = async (key: string, b: Blob) =>
  set(key, { type: b.type, bytes: await b.arrayBuffer() } satisfies StoredBlob);
export const getBlob = async (key: string): Promise<Blob | undefined> => {
  const v = await get<StoredBlob | Blob>(key);
  if (!v) return undefined;
  return v instanceof Blob ? v : new Blob([v.bytes], { type: v.type });
};
export const clearAll = () => clear();
