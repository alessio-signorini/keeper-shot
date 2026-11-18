import type { Face, Frame, Person } from '../types';
import { chooseBase, type BaseEvaluation } from './baseFrame';
import { dropBlurryPeople, groupFaces } from './grouping';
import { eyesScore, normalizeSharpness, scoreFace } from './scoring';

export interface Analysis {
  people: Person[];
  /** only the faces that belong to a kept person, with final scores */
  faces: Record<string, Face>;
  base: BaseEvaluation;
}

/** Group aligned faces into people, drop blurry "people", score every face within its person, and choose the base. */
export function analyzePeople(frames: Frame[], faces: Record<string, Face>, refFrameId: string): Analysis {
  const people = dropBlurryPeople(groupFaces(frames, faces), faces);
  const scores = new Map<string, Face['score']>();
  for (const p of people) {
    const ids = Object.values(p.faces);
    const sharpNorm = normalizeSharpness(ids.map((id) => faces[id].sharpness));
    const eyesRef = Math.max(...ids.map((id) => eyesScore(faces[id].blend)));
    ids.forEach((id, i) => scores.set(id, scoreFace(faces[id].blend, faces[id].pose, sharpNorm[i], eyesRef)));
  }
  // keep the detection order of `faces`
  const kept: Record<string, Face> = {};
  for (const [id, f] of Object.entries(faces)) {
    const score = scores.get(id);
    if (score) kept[id] = { ...f, score };
  }
  return { people, faces: kept, base: chooseBase(frames, people, kept, refFrameId) };
}
