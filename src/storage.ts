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
export const putBlob = (key: string, b: Blob) => set(key, b);
export const getBlob = (key: string) => get<Blob>(key);
export const clearAll = () => clear();
