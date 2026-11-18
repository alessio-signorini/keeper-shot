import { useEffect, useRef, useState } from 'preact/hooks';
import { APP_NAME, MAX_FILES, MIN_FILES, THUMB_PX, THUMB_QUALITY } from '../config';
import { resumeSession, startAnalysis, startOver } from '../app/actions';
import { files, savedSession } from '../app/store';

const fileKey = (f: File) => `${f.name}:${f.size}:${f.lastModified}`;

export function Upload() {
  const list = files.value;
  const [urls, setUrls] = useState<string[]>([]);
  // thumbnails are cached per file so adding photos only decodes the new ones
  const cache = useRef(new Map<string, string>());
  // small thumbnails, one decode at a time, so a 24MP burst is never fully decoded on the page
  useEffect(() => {
    let live = true;
    const keys = new Set(list.map(fileKey));
    for (const [k, u] of cache.current) {
      if (!keys.has(k)) {
        if (u) URL.revokeObjectURL(u);
        cache.current.delete(k);
      }
    }
    setUrls(list.map((f) => cache.current.get(fileKey(f)) ?? ''));
    void (async () => {
      for (const f of list) {
        const key = fileKey(f);
        if (cache.current.has(key)) continue;
        if (!live) return; // Start was pressed or files changed: stop decoding photos on the page
        let url = '';
        try {
          const bmp = await createImageBitmap(f, {
            resizeWidth: THUMB_PX,
            resizeQuality: 'low',
            imageOrientation: 'from-image',
          });
          const c = document.createElement('canvas');
          c.width = bmp.width;
          c.height = bmp.height;
          c.getContext('2d')!.drawImage(bmp, 0, 0);
          bmp.close();
          const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', THUMB_QUALITY));
          if (blob) url = URL.createObjectURL(blob);
        } catch {
          // unreadable photo: leave its thumbnail blank
        }
        if (!live) {
          if (url) URL.revokeObjectURL(url);
          return;
        }
        cache.current.set(key, url);
        setUrls(list.map((g) => cache.current.get(fileKey(g)) ?? ''));
      }
    })();
    return () => {
      live = false;
    };
  }, [list]);
  useEffect(
    () => () => {
      cache.current.forEach((u) => u && URL.revokeObjectURL(u));
      cache.current.clear();
    },
    [],
  );
  const ok = list.length >= MIN_FILES && list.length <= MAX_FILES;

  const pick = (fl: FileList | File[] | null) => {
    if (!fl) return;
    const added = Array.from(fl).filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
    const seen = new Set(list.map(fileKey));
    const fresh = added.filter((f) => !seen.has(fileKey(f)));
    files.value = [...list, ...fresh].slice(0, MAX_FILES);
  };

  const fileInput = (
    <input
      type="file"
      accept="image/*,.heic,.heif"
      multiple
      class="hidden"
      onChange={(e) => {
        const input = e.target as HTMLInputElement;
        pick(input.files);
        input.value = '';
      }}
    />
  );

  return (
    <div class="flex flex-1 flex-col gap-4 p-4">
      <header class="flex flex-col gap-1">
        <h1 class="flex items-center gap-2 text-2xl font-bold text-orange-500">
          <img src={`${import.meta.env.BASE_URL}icons/icon.svg`} alt="" class="h-8 w-8 rounded-lg" />
          {APP_NAME}
        </h1>
        <p class="text-base font-medium">Everyone looking their best, in one photo.</p>
        <p class="text-sm text-neutral-600">
          Took several shots of the same group and someone always blinked or looked away? Add the burst and KeeperShot
          merges the best face of each person into a single keeper.
        </p>
        <p class="mt-1 inline-flex w-fit items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-800">
          🔒 100% private: your photos never leave this device. No uploads, no account.
        </p>
      </header>
      {savedSession.value && (
        <div class="flex items-center justify-between rounded-xl bg-orange-50 p-3">
          <span class="text-sm">You have a previous session.</span>
          <span class="flex gap-2">
            <button class="rounded-lg bg-orange-500 px-3 py-1.5 text-sm font-medium text-white" onClick={resumeSession}>
              Resume
            </button>
            <button class="rounded-lg border px-3 py-1.5 text-sm" onClick={startOver}>
              Start over
            </button>
          </span>
        </div>
      )}
      {list.length === 0 ? (
        <label
          class="flex min-h-48 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-orange-300 bg-orange-50 p-6 text-center"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            pick(e.dataTransfer?.files ?? null);
          }}
        >
          <span class="text-lg font-medium">
            Pick {MIN_FILES}–{MAX_FILES} shots of the same group.
          </span>
          <span class="text-sm text-neutral-500">Tap or drop photos here</span>
          {fileInput}
        </label>
      ) : (
        <>
          <div class="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {urls.map(
              (u, i) =>
                u && <img key={u} src={u} alt={list[i].name} class="aspect-square w-full rounded-lg object-cover" />,
            )}
            {list.length < MAX_FILES && (
              <label
                class="flex aspect-square w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-orange-300 bg-orange-50 text-center text-orange-600"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  pick(e.dataTransfer?.files ?? null);
                }}
              >
                <span class="text-3xl leading-none">+</span>
                <span class="text-xs font-medium">Add more</span>
                {fileInput}
              </label>
            )}
          </div>
          <p class="flex items-center justify-between text-sm text-neutral-500">
            <span>
              {list.length} selected{!ok && ` — need ${MIN_FILES}–${MAX_FILES}`}
            </span>
            <button class="rounded-lg border px-3 py-1 text-neutral-700" onClick={() => (files.value = [])}>
              Clear all
            </button>
          </p>
        </>
      )}
      {list.length === 0 && (
        <section class="grid gap-3 text-sm sm:grid-cols-2">
          <div class="rounded-xl border border-neutral-200 p-3">
            <h2 class="mb-1 font-semibold">Done automatically</h2>
            <ul class="list-disc space-y-0.5 pl-5 text-neutral-600">
              <li>Finds every face and matches each person across shots</li>
              <li>Picks the best base photo and aligns the others to it</li>
              <li>Chooses each person's best face (eyes open, smiling, looking ahead)</li>
              <li>Blends everything seamlessly into one JPEG</li>
            </ul>
          </div>
          <div class="rounded-xl border border-neutral-200 p-3">
            <h2 class="mb-1 font-semibold">Yours to adjust</h2>
            <ul class="list-disc space-y-0.5 pl-5 text-neutral-600">
              <li>Swap any person's pick for another shot</li>
              <li>Change the base photo</li>
              <li>Preview the result before saving</li>
              <li>Pick up where you left off after a reload</li>
            </ul>
          </div>
        </section>
      )}
      <p class="text-center text-xs text-neutral-500">
        Works best with photos taken from the same spot (handheld bursts are fine). JPEG, PNG or HEIC. Processing runs
        on your device, so large bursts can take a minute.
      </p>
      <button
        class="mt-auto rounded-xl bg-orange-500 py-3 text-lg font-semibold text-white disabled:opacity-40"
        disabled={!ok}
        onClick={startAnalysis}
      >
        Start
      </button>
    </div>
  );
}
