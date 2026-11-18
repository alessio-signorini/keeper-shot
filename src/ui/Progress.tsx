import { useEffect, useRef } from 'preact/hooks';
import { startOver } from '../app/actions';
import { counters, detectedFaces, pipelineError, progressLog, progressPercent, session } from '../app/store';
import { useStoredUrl } from '../app/useStoredUrl';
import { faceThumbKey } from '../storage';

function Thumb({ id, blink, best }: { id: string; blink: boolean; best?: boolean }) {
  const url = useStoredUrl(faceThumbKey(id));
  return (
    <span
      class={`relative inline-block h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-neutral-100 ${best ? 'ring-4 ring-amber-400 shadow-[0_0_12px_#fbbf24]' : ''}`}
    >
      {url && <img src={url} class="h-full w-full object-cover" alt="" />}
      {blink && <span class="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-red-500" />}
    </span>
  );
}

export function Progress() {
  const feedEnd = useRef<HTMLDivElement>(null);
  useEffect(() => feedEnd.current?.scrollIntoView({ block: 'nearest' }), [progressLog.value.length]);
  const c = counters.value;
  const s = session.value;
  const flags = new Map(detectedFaces.value.map((t) => [t.faceId, t]));

  // rows: one per person once grouped, otherwise one per frame
  const rows: { key: string; ids: string[]; bestId?: string }[] = s?.people.length
    ? s.people.map((p) => {
        const ids = Object.values(p.faces);
        const bestId = ids.reduce((a, b) => (s.faces[a].score.total >= s.faces[b].score.total ? a : b));
        return { key: p.id, ids, bestId };
      })
    : Object.entries(
        detectedFaces.value.reduce<Record<string, string[]>>(
          (acc, t) => ((acc[t.frameId] ??= []).push(t.faceId), acc),
          {},
        ),
      ).map(([key, ids]) => ({ key, ids }));

  return (
    <div class="flex flex-1 flex-col gap-3 overflow-hidden p-4">
      <h2 class="text-xl font-semibold">Finding everyone…</h2>
      <div
        class="h-3 overflow-hidden rounded-full bg-neutral-200"
        role="progressbar"
        aria-valuenow={Math.round(progressPercent.value)}
      >
        <div class="h-full bg-orange-500 transition-all" style={{ width: `${progressPercent.value}%` }} />
      </div>
      <div class="grid grid-cols-4 gap-2 text-center text-sm">
        <Counter label="faces found" v={c.faces} />
        <Counter label="people" v={s?.people.length ?? 0} />
        <Counter label="blinks caught" v={c.blinks} />
        <Counter label="looking away" v={c.away} />
      </div>
      <div class="text-center text-xs text-neutral-500">{c.funny} funny faces</div>
      <div class="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {rows.map((r) => (
          <div key={r.key} class="flex gap-2 overflow-x-auto pb-1">
            {r.ids.map((id) => (
              <Thumb key={id} id={id} blink={flags.get(id)?.blink ?? false} best={id === r.bestId} />
            ))}
          </div>
        ))}
      </div>
      <div class="max-h-32 overflow-y-auto rounded-lg bg-neutral-50 p-2 text-xs text-neutral-600">
        {progressLog.value.map((m, i) => (
          <div key={i}>{m}</div>
        ))}
        <div ref={feedEnd} />
      </div>
      {pipelineError.value && (
        <div class="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          Something went wrong: {pipelineError.value}
          <button class="ml-2 underline" onClick={startOver}>
            Start over
          </button>
        </div>
      )}
    </div>
  );
}

function Counter({ label, v }: { label: string; v: number }) {
  return (
    <div class="rounded-lg bg-orange-50 p-2">
      <div class="text-xl font-bold text-orange-600">{v}</div>
      <div class="text-[11px] text-neutral-500">{label}</div>
    </div>
  );
}
