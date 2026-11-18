import { applyAll, boxOf, invert } from '../core/geometry';
import { baseFrame, faceInFrame, personById } from '../core/session';
import type { Box, Pt, Session } from '../types';

function styleFor(s: Session, personId: string, amber: boolean) {
  const pick = s.picks[personId];
  if (amber)
    return {
      icon: '⚠',
      border: pick?.mode === 'skip' ? 'border-dashed border-amber-400' : 'border-amber-400',
      chip: 'bg-amber-400 text-black',
    };
  if (pick?.mode === 'eyes') return { icon: '👁', border: 'border-blue-500', chip: 'bg-blue-500 text-white' };
  if (pick?.mode === 'face') return { icon: '🙂', border: 'border-purple-500', chip: 'bg-purple-500 text-white' };
  if (pick?.mode === 'skip')
    return { icon: '∅', border: 'border-dashed border-white/70', chip: 'bg-white/70 text-neutral-600' };
  return { icon: '✓', border: 'border-white/80', chip: 'bg-white/80 text-neutral-700' };
}

/** The person's face rectangle in base-frame coordinates, as percentages of the frame. */
function faceRect(s: Session, personId: string): Box {
  const person = personById(s, personId);
  const base = baseFrame(s);
  const box = faceInFrame(person, base.id, s.faces)?.box ?? estimatedBox(s, personId);
  return {
    x: (box.x / base.width) * 100,
    y: (box.y / base.height) * 100,
    w: (box.w / base.width) * 100,
    h: (box.h / base.height) * 100,
  };
}

/** For a person not detected in the base frame: one of their faces (ref coords) mapped into the base frame. */
function estimatedBox(s: Session, personId: string): Box {
  const person = personById(s, personId);
  const r = s.faces[Object.values(person.faces)[0]].refBox;
  const corners: Pt[] = [
    [r.x, r.y],
    [r.x + r.w, r.y + r.h],
  ];
  return boxOf(applyAll(invert(baseFrame(s).toRef), corners));
}

/** A tappable rectangle with a status chip over each person's face, positioned in % of the base frame. */
export function FaceMarkers({
  session: s,
  attention,
  onOpen,
}: {
  session: Session;
  attention: Set<string>;
  onOpen: (personId: string) => void;
}) {
  return (
    <>
      {s.people.map((p) => {
        const r = faceRect(s, p.id);
        const st = styleFor(s, p.id, attention.has(p.id));
        return (
          <button
            key={p.id}
            aria-label={`Person ${p.id}`}
            class={`absolute rounded-md border-2 ${st.border}`}
            style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%` }}
            onClick={() => onOpen(p.id)}
          >
            <span
              class={`absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full text-[11px] shadow ${st.chip}`}
            >
              {st.icon}
            </span>
          </button>
        );
      })}
    </>
  );
}
