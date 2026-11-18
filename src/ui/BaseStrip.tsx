import { swapCountByFrame } from '../app/store';
import { useStoredUrl } from '../app/useStoredUrl';
import { frameThumbKey } from '../storage';
import type { Session } from '../types';

export function BaseStrip({ session, onPick }: { session: Session; onPick: (frameId: string) => void }) {
  return (
    <div class="flex gap-2 overflow-x-auto px-2 py-2">
      {session.frames.map((f) => (
        <FrameThumb key={f.id} s={session} id={f.id} onPick={onPick} />
      ))}
    </div>
  );
}

function FrameThumb({ s, id, onPick }: { s: Session; id: string; onPick: (id: string) => void }) {
  const url = useStoredUrl(frameThumbKey(id));
  const active = s.baseFrameId === id;
  const n = swapCountByFrame.value.get(id) ?? 0;
  return (
    <button class="shrink-0 text-center" onClick={() => onPick(id)}>
      <span
        class={`block h-14 w-20 overflow-hidden rounded-lg bg-neutral-200 ${active ? 'ring-2 ring-orange-500' : ''}`}
      >
        {url && <img src={url} class="h-full w-full object-cover" alt="" />}
      </span>
      <span class="text-[11px] text-neutral-600">
        {n} fix{n === 1 ? '' : 'es'}
      </span>
    </button>
  );
}
