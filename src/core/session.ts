import type { Face, Frame, Person, Session } from '../types';

// Lookups shared by the worker, state and UI. Ids are assumed valid: callers pass ids taken from the same session.

export function frameById(frames: Frame[], id: string): Frame {
  return frames.find((f) => f.id === id)!;
}

export function baseFrame(s: Session): Frame {
  return frameById(s.frames, s.baseFrameId);
}

export function personById(s: Session, id: string): Person {
  return s.people.find((p) => p.id === id)!;
}

export function personOfFace(people: Person[], faceId: string): Person | undefined {
  return people.find((p) => Object.values(p.faces).includes(faceId));
}

/** The person's face in a given frame, or undefined when they weren't detected there. */
export function faceInFrame(person: Person, frameId: string, faces: Record<string, Face>): Face | undefined {
  const id = person.faces[frameId];
  return id ? faces[id] : undefined;
}

export function facesOfFrame(faces: Record<string, Face>, frameId: string): Face[] {
  return Object.values(faces).filter((f) => f.frameId === frameId);
}
