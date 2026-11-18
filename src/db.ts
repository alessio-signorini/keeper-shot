import { clear, get, set } from 'idb-keyval';
import type { Session } from './types';

export const frameKey = (id: string) => `frame:${id}`;
export const fthumbKey = (frameId: string) => `fthumb:${frameId}`;
export const thumbKey = (faceId: string) => `thumb:${faceId}`;

export const saveSession = (s: Session) => set('session', s);
export const loadSession = () => get<Session>('session');
export const putBlob = (key: string, b: Blob) => set(key, b);
export const getBlob = (key: string) => get<Blob>(key);
export const clearAll = () => clear();
