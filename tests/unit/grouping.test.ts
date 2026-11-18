import { describe, expect, it } from 'vitest';
import { groupFaces } from '../../src/core/grouping';
import type { Face } from '../../src/types';
import { makeFace, makeFrame } from './factories';

describe('grouping', () => {
  it('groups jittered faces, handles misses and drops passers-by', () => {
    const frames = [makeFrame('f0'), makeFrame('f1'), makeFrame('f2'), makeFrame('f3'), makeFrame('f4')];
    const faces: Record<string, Face> = {};
    const add = (f: Face) => (faces[f.id] = f);
    const xs = [100, 300, 500];
    frames.forEach((f, fi) => {
      xs.forEach((x, i) => {
        if (fi === 2 && i === 1) return; // missed detection
        add(makeFace(f.id, i, x + ((fi * 7) % 9) - 4, 200 + ((fi * 5) % 7) - 3));
      });
    });
    add(makeFace('f1', 9, 900, 200)); // passer-by, one frame
    const people = groupFaces(frames, faces);
    expect(people.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
    expect(Object.keys(people[1].faces)).toHaveLength(4);
    expect(Object.keys(people[0].faces)).toHaveLength(5);
  });

  it('keeps a person who moved a few face-widths as one person', () => {
    const frames = [
      makeFrame('f0'),
      makeFrame('f1'),
      makeFrame('f2'),
      makeFrame('f3'),
      makeFrame('f4'),
      makeFrame('f5'),
    ];
    const faces: Record<string, Face> = {};
    frames.forEach((f, fi) => {
      faces[`${f.id}:0`] = makeFace(f.id, 0, 100, 200); // stays put
      faces[`${f.id}:1`] = makeFace(f.id, 1, fi < 3 ? 400 : 560, 200); // moves ~1.6 widths (face width 100)
    });
    const people = groupFaces(frames, faces);
    expect(people).toHaveLength(2);
    expect(Object.keys(people[1].faces)).toHaveLength(6);
  });
});
