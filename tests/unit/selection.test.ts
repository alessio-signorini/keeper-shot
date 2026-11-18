import { describe, expect, it } from 'vitest';
import { chooseBase } from '../../src/core/baseFrame';
import { swapFeasibility } from '../../src/core/feasibility';
import { groupFaces } from '../../src/core/grouping';
import { choosePick, rebase } from '../../src/core/picks';
import type { Face } from '../../src/types';
import { makeFace, makeFrame } from './factories';

describe('selection', () => {
  const blink = { eyeBlinkLeft: 0.9, eyeBlinkRight: 0.9, mouthSmileLeft: 0.5, mouthSmileRight: 0.5 };
  const good = { mouthSmileLeft: 0.5, mouthSmileRight: 0.5 };
  const setup = () => {
    const frames = [makeFrame('f0'), makeFrame('f1', 200)];
    const faces: Record<string, Face> = {};
    const add = (f: Face) => (faces[f.id] = f);
    // person 1 blinks in f0, fine in f1; person 2 fine in both
    add(makeFace('f0', 0, 100, 200, {}, blink));
    add(makeFace('f1', 0, 100, 200, {}, good));
    add(makeFace('f0', 1, 400, 200, {}, good));
    add(makeFace('f1', 1, 400, 200, {}, good));
    const people = groupFaces(frames, faces);
    return { frames, faces, people };
  };
  it('swaps eyes when only the eyes are bad', () => {
    const { faces, people } = setup();
    const c = choosePick(people[0], 'f0', faces);
    expect(c.pick?.mode).toBe('eyes');
    expect(c.pick?.faceId).toBe('f1:0');
  });
  it('picks the base frame holding the most best faces', () => {
    const { frames, faces, people } = setup();
    const b = chooseBase(frames, people, faces, 'f0');
    expect(b.frameId).toBe('f1');
    expect(b.swaps).toBe(0);
  });
  it('disables candidates with too much pose change', () => {
    const a = makeFace('f0', 0, 100, 200, { pose: { yaw: 0, pitch: 0, roll: 0 } });
    const b = makeFace('f1', 0, 100, 200, { pose: { yaw: 10, pitch: 0, roll: 0 } });
    const f = swapFeasibility(b, a);
    expect(f.eyes.ok).toBe(false);
    expect(f.eyes.reason).toMatch(/turned/);
    expect(f.face.ok).toBe(true);
    const c = makeFace('f1', 0, 100, 200, { pose: { yaw: 20, pitch: 0, roll: 0 } });
    expect(swapFeasibility(c, a).face.ok).toBe(false);
  });
  it('leaves the photo untouched for a person missing from the base frame, and keeps a manual skip', () => {
    const { frames, faces, people } = setup();
    delete faces['f0:0'];
    delete people[0].faces.f0;
    const c = choosePick(people[0], 'f0', faces);
    expect(c.pick).toMatchObject({ mode: 'skip', faceId: '' });
    const manualSkip = { p1: { personId: 'p1', faceId: '', mode: 'skip' as const, auto: false } };
    expect(rebase('f0', people, faces, manualSkip).p1.mode).toBe('skip');
    expect(rebase('f1', people, faces, manualSkip).p1.mode).toBe('base');
  });
  it('only allows face mode when the base face is missing', () => {
    const src = makeFace('f1', 0, 100, 200);
    const f = swapFeasibility(src, undefined);
    expect(f.eyes.ok).toBe(false);
    expect(f.face.ok).toBe(true);
  });
  it('prefers the reference frame when candidate bases tie', () => {
    const frames = [makeFrame('f0', 500), makeFrame('f1', 100)];
    const faces: Record<string, Face> = {};
    for (const f of frames) faces[`${f.id}:0`] = makeFace(f.id, 0, 100, 200);
    const people = groupFaces(frames, faces);
    expect(chooseBase(frames, people, faces, 'f1').frameId).toBe('f1');
    expect(chooseBase(frames, people, faces, 'none').frameId).toBe('f0');
  });
});
