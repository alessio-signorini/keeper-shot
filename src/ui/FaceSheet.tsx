import { useState } from 'preact/hooks';
import { refreshPreview, setPick } from '../app/actions';
import { session } from '../app/store';
import { useStoredUrl } from '../app/useStoredUrl';
import { autoMode, swapFeasibility } from '../core/feasibility';
import { faceInFrame, personById } from '../core/session';
import { faceThumbKey } from '../storage';
import type { Face, FacePick, PickMode, SwapMode } from '../types';

/** The unconfirmed choice shown in the sheet (and previewed behind it). */
interface Draft {
  faceId: string;
  mode: PickMode;
}

function Candidate({
  face,
  baseFace,
  selected,
  onSelect,
}: {
  face: Face;
  baseFace: Face | undefined;
  selected: boolean;
  onSelect: (faceId: string) => void;
}) {
  const url = useStoredUrl(faceThumbKey(face.id));
  const isBase = face.id === baseFace?.id;
  const feasibility = isBase ? null : swapFeasibility(face, baseFace);
  const risky = feasibility ? !feasibility.eyes.ok && !feasibility.face.ok : false;
  const reason = feasibility?.face.reason ?? feasibility?.eyes.reason;
  const pct = (v: number) => Math.round(v * 100);
  return (
    <button
      onClick={() => onSelect(face.id)}
      class={`w-28 shrink-0 rounded-xl border p-1.5 text-left ${selected ? 'border-orange-500 ring-2 ring-orange-300' : 'border-neutral-200'} ${risky ? 'opacity-60' : ''}`}
    >
      <span class="block h-24 overflow-hidden rounded-lg bg-neutral-100">
        {url && <img src={url} class="h-full w-full object-cover" alt="" />}
      </span>
      <span class="mt-1 flex flex-wrap gap-x-1.5 text-[11px] text-neutral-700">
        <span>👁 {pct(face.score.eyes)}</span>
        <span>↗ {pct(face.score.gaze)}</span>
        <span>🙂 {pct(face.score.smile)}</span>
      </span>
      <span class="text-xs font-semibold">
        {pct(face.score.total)}
        {isBase && ' · base'}
      </span>
      {risky && <span class="block text-[10px] text-amber-600">{reason} · tap to force</span>}
    </button>
  );
}

export function FaceSheet({ personId, onClose }: { personId: string; onClose: () => void }) {
  const s = session.value!;
  const person = personById(s, personId);
  const current = s.picks[personId];
  const baseFace = faceInFrame(person, s.baseFrameId, s.faces);
  const baseFaceId = baseFace?.id;
  const [draft, setDraft] = useState<Draft>(
    current
      ? { faceId: current.faceId, mode: current.mode }
      : baseFaceId
        ? { faceId: baseFaceId, mode: 'base' }
        : { faceId: '', mode: 'skip' },
  );

  const preview = (d: Draft) => {
    setDraft(d);
    const pick: FacePick = { personId, faceId: d.faceId, mode: d.mode, auto: false };
    void refreshPreview({ ...s.picks, [personId]: pick });
  };

  const select = (faceId: string) => {
    if (faceId === baseFaceId) return preview({ faceId, mode: 'base' });
    const feasibility = swapFeasibility(s.faces[faceId], baseFace);
    const keepMode = (draft.mode === 'eyes' || draft.mode === 'face') && feasibility[draft.mode].ok;
    const mode = keepMode ? draft.mode : autoMode(s.faces[faceId], baseFace, feasibility);
    preview({ faceId, mode: mode ?? 'face' }); // infeasible faces can still be forced as a face swap
  };

  const selected = draft.faceId;
  const feasibility = selected && selected !== baseFaceId ? swapFeasibility(s.faces[selected], baseFace) : null;

  const confirm = async () => {
    await setPick({ personId, faceId: draft.faceId, mode: draft.mode, auto: false });
    onClose();
  };
  const cancel = () => {
    void refreshPreview();
    onClose();
  };

  return (
    <div
      class="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-3xl rounded-t-2xl bg-white p-3 shadow-[0_-8px_30px_rgba(0,0,0,.2)]"
      role="dialog"
      aria-label="Choose face"
    >
      <div class="mb-2 text-sm font-semibold">Person {personId.replace('p', '')}</div>
      {!baseFaceId && (
        <p class="mb-2 text-xs text-neutral-500">
          Not detected in this photo (often turned away or hidden). Adding a face here can look doubled — keep “None”
          unless it looks right.
        </p>
      )}
      <div class="flex gap-2 overflow-x-auto pb-2">
        {!baseFaceId && (
          <button
            onClick={() => preview({ faceId: '', mode: 'skip' })}
            class={`flex w-28 shrink-0 flex-col items-center justify-center rounded-xl border p-1.5 text-center ${draft.mode === 'skip' ? 'border-orange-500 ring-2 ring-orange-300' : 'border-neutral-200'}`}
          >
            <span class="flex h-24 w-full items-center justify-center rounded-lg bg-neutral-100 text-3xl text-neutral-400">
              ∅
            </span>
            <span class="mt-1 text-xs font-semibold">None</span>
            <span class="text-[10px] text-neutral-500">leave photo as is</span>
          </button>
        )}
        {Object.values(person.faces).map((fid) => (
          <Candidate
            key={fid}
            face={s.faces[fid]}
            baseFace={baseFace}
            selected={draft.faceId === fid}
            onSelect={select}
          />
        ))}
      </div>
      <div class="my-2 inline-flex overflow-hidden rounded-lg border text-sm">
        {(['eyes', 'face'] as SwapMode[]).map((m) => {
          const ok = !!feasibility && (feasibility[m].ok || m === 'face');
          return (
            <button
              key={m}
              disabled={!ok}
              title={feasibility && !ok ? feasibility[m].reason : undefined}
              class={`px-4 py-1.5 ${draft.mode === m ? 'bg-orange-500 text-white' : ''} ${ok ? '' : 'cursor-not-allowed text-neutral-300'}`}
              onClick={() => preview({ ...draft, mode: m })}
            >
              {m === 'eyes' ? 'Eyes' : 'Face'}
            </button>
          );
        })}
      </div>
      <div class="mt-2 flex gap-2">
        <button class="flex-1 rounded-xl border py-2" onClick={cancel}>
          Cancel
        </button>
        <button class="flex-1 rounded-xl bg-orange-500 py-2 font-semibold text-white" onClick={confirm}>
          Confirm
        </button>
      </div>
    </div>
  );
}
