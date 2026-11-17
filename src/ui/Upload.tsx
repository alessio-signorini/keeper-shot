import { useEffect, useMemo } from 'preact/hooks';
import { APP_NAME, MAX_FILES, MIN_FILES } from '../config';
import { files, resume, savedSession, start, startOver } from '../state';

export function Upload() {
  const list = files.value;
  const urls = useMemo(() => list.map((f) => URL.createObjectURL(f)), [list]);
  useEffect(() => () => urls.forEach(URL.revokeObjectURL), [urls]);
  const ok = list.length >= MIN_FILES && list.length <= MAX_FILES;

  const pick = (fl: FileList | File[] | null) => {
    if (!fl) return;
    files.value = Array.from(fl).filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name)).slice(0, MAX_FILES);
  };

  return (
    <div class="flex flex-1 flex-col gap-4 p-4">
      <h1 class="text-2xl font-bold text-orange-500">{APP_NAME}</h1>
      {savedSession.value && (
        <div class="flex items-center justify-between rounded-xl bg-orange-50 p-3">
          <span class="text-sm">You have a previous session.</span>
          <span class="flex gap-2">
            <button class="rounded-lg bg-orange-500 px-3 py-1.5 text-sm font-medium text-white" onClick={resume}>Resume</button>
            <button class="rounded-lg border px-3 py-1.5 text-sm" onClick={startOver}>Start over</button>
          </span>
        </div>
      )}
      <label
        class="flex min-h-48 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-orange-300 bg-orange-50 p-6 text-center"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer?.files ?? null); }}
      >
        <span class="text-lg font-medium">Pick {MIN_FILES}–{MAX_FILES} shots of the same group.</span>
        <span class="text-sm text-neutral-500">Tap or drop photos here</span>
        <input type="file" accept="image/*,.heic,.heif" multiple class="hidden" onChange={(e) => pick((e.target as HTMLInputElement).files)} />
      </label>
      {list.length > 0 && (
        <>
          <div class="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {urls.map((u, i) => <img key={u} src={u} alt={list[i].name} class="aspect-square w-full rounded-lg object-cover" />)}
          </div>
          <p class="text-sm text-neutral-500">
            {list.length} selected{!ok && ` — need ${MIN_FILES}–${MAX_FILES}`}
          </p>
        </>
      )}
      <button
        class="mt-auto rounded-xl bg-orange-500 py-3 text-lg font-semibold text-white disabled:opacity-40"
        disabled={!ok}
        onClick={start}
      >
        Start
      </button>
    </div>
  );
}
