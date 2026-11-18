import Panzoom from '@panzoom/panzoom';
import { useEffect, useRef, useState } from 'preact/hooks';
import { renderOriginalBase, saveComposite, setBase, startOver } from '../app/actions';
import { attentionPersonIds, previewBitmap, saving, session, showingOriginal } from '../app/store';
import { baseFrame } from '../core/session';
import { BaseStrip } from './BaseStrip';
import { FaceMarkers } from './FaceMarkers';
import { FaceSheet } from './FaceSheet';

const LONG_PRESS_MS = 350;
const MOVE_SLOP = 8;

export function Review() {
  const s = session.value!;
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const plain = useRef<ImageBitmap | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [cursor, setCursor] = useState(-1);
  const [fit, setFit] = useState({ w: 0, h: 0 });
  const pzRef = useRef<ReturnType<typeof Panzoom> | null>(null);
  const [overlays, setOverlays] = useState(true);
  const press = useRef<{ timer: number; x: number; y: number } | null>(null);

  const base = baseFrame(s);
  useEffect(() => {
    const parent = holder.current!;
    const measure = () => {
      const { width, height } = parent.getBoundingClientRect();
      const k = Math.min(width / base.width, height / base.height);
      setFit({ w: Math.floor(base.width * k), h: Math.floor(base.height * k) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [base.width, base.height]);

  useEffect(() => {
    const el = stage.current!;
    // pan is clamped so the photo always covers its frame: at 1x nothing can move
    const pz = Panzoom(el, { maxScale: 8, minScale: 1, cursor: 'grab' });
    pzRef.current = pz;
    const clamp = () => {
      const scale = pz.getScale(),
        { x, y } = pz.getPan();
      const mx = (el.offsetWidth * (scale - 1)) / (2 * scale),
        my = (el.offsetHeight * (scale - 1)) / (2 * scale);
      const px = Math.max(-mx, Math.min(mx, x)),
        py = Math.max(-my, Math.min(my, y));
      if (Math.abs(px - x) > 0.5 || Math.abs(py - y) > 0.5) pz.pan(px, py, { force: true, animate: false });
    };
    el.addEventListener('panzoomchange', clamp);
    const parent = holder.current!;
    parent.addEventListener('wheel', pz.zoomWithWheel);
    return () => {
      parent.removeEventListener('wheel', pz.zoomWithWheel);
      pz.destroy();
      pzRef.current = null;
    };
  }, []);

  const bmp = showingOriginal.value ? plain.current : previewBitmap.value;
  useEffect(() => {
    const c = canvas.current;
    const b = showingOriginal.value && plain.current ? plain.current : previewBitmap.value;
    if (!c || !b) return;
    c.width = b.width;
    c.height = b.height;
    c.getContext('2d')!.drawImage(b, 0, 0);
  }, [bmp, showingOriginal.value, previewBitmap.value]);

  const down = (e: PointerEvent) => {
    const t = window.setTimeout(async () => {
      plain.current?.close();
      plain.current = await renderOriginalBase();
      showingOriginal.value = true;
    }, LONG_PRESS_MS);
    press.current = { timer: t, x: e.clientX, y: e.clientY };
  };
  const move = (e: PointerEvent) => {
    const p = press.current;
    if (p && !showingOriginal.value && Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_SLOP) {
      clearTimeout(p.timer);
      press.current = null;
    }
  };
  const up = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
    showingOriginal.value = false;
  };

  const amber = new Set(attentionPersonIds.value);
  const next = () => {
    const ids = [...amber];
    if (!ids.length) return;
    const i = (cursor + 1) % ids.length;
    setCursor(i);
    setOpen(ids[i]);
  };

  return (
    <div class="relative flex h-full flex-col">
      <div class="flex items-center justify-between p-2">
        <button class="rounded-lg border px-3 py-1.5 text-sm" onClick={startOver}>
          Start over
        </button>
        <button
          class="rounded-lg border border-amber-400 px-3 py-1.5 text-sm disabled:opacity-40"
          disabled={!amber.size}
          onClick={next}
        >
          Next to check ({amber.size})
        </button>
        <span class="flex gap-1">
          <button
            class="rounded-lg border px-2.5 py-1.5 text-sm"
            aria-label="Zoom out"
            onClick={() => pzRef.current?.zoomOut()}
          >
            −
          </button>
          <button
            class="rounded-lg border px-2.5 py-1.5 text-sm"
            aria-label="Zoom in"
            onClick={() => pzRef.current?.zoomIn()}
          >
            +
          </button>
          <button
            class={`rounded-lg border px-2.5 py-1.5 text-sm ${overlays ? 'bg-orange-100' : ''}`}
            aria-pressed={overlays}
            title="Show or hide the face markers"
            aria-label="Toggle face markers"
            onClick={() => setOverlays(!overlays)}
          >
            ◻︎
          </button>
          <button
            class="rounded-lg bg-orange-500 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            disabled={saving.value}
            onClick={() => void saveComposite()}
          >
            {saving.value ? 'Saving…' : 'Save'}
          </button>
          <button
            class="rounded-lg border px-2.5 py-1.5 text-sm disabled:opacity-50"
            disabled={saving.value}
            title="Download the file"
            aria-label="Download"
            onClick={() => void saveComposite('download')}
          >
            ⬇
          </button>
        </span>
      </div>
      <div
        ref={holder}
        class="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
        style={{ touchAction: 'none' }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={up}
      >
        <div ref={stage} class="relative" style={{ width: `${fit.w}px`, height: `${fit.h}px` }}>
          <canvas ref={canvas} class="h-full w-full select-none" />
          {!showingOriginal.value && overlays && <FaceMarkers session={s} attention={amber} onOpen={setOpen} />}
          {showingOriginal.value && (
            <div class="absolute left-2 top-2 rounded bg-black/60 px-2 py-1 text-xs text-white">Original</div>
          )}
        </div>
      </div>
      <BaseStrip session={s} onPick={(id) => void setBase(id)} />
      {open && <FaceSheet key={open} personId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
