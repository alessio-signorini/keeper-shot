import Panzoom from '@panzoom/panzoom';
import { useEffect, useRef, useState } from 'preact/hooks';
import { apply, center, invert } from '../core/geometry';
import {
  attentionPeople, comparing, plainBase, previewBitmap, saveResult, saving, session, setBase, startOver,
} from '../state';
import type { Session } from '../types';
import { BaseStrip } from './BaseStrip';
import { FaceSheet } from './FaceSheet';

const LONG_PRESS_MS = 350;
const MOVE_SLOP = 8;

function badgeFor(s: Session, personId: string, amber: boolean) {
  const pick = s.picks[personId];
  if (amber) return { icon: '⚠', cls: 'bg-amber-400 text-black' };
  if (pick?.mode === 'eyes') return { icon: '👁', cls: 'bg-blue-500 text-white' };
  if (pick?.mode === 'face') return { icon: '🙂', cls: 'bg-purple-500 text-white' };
  return { icon: '✓', cls: 'bg-neutral-400 text-white' };
}

function facePos(s: Session, personId: string): { x: number; y: number } | null {
  const p = s.people.find((q) => q.id === personId)!;
  const base = s.frames.find((f) => f.id === s.baseFrameId)!;
  const bf = p.faces[base.id];
  let c: [number, number];
  if (bf) c = center(s.faces[bf].box);
  else {
    const any = s.faces[Object.values(p.faces)[0]];
    c = apply(invert(base.toRef), center(any.refBox));
  }
  return { x: (c[0] / base.width) * 100, y: (c[1] / base.height) * 100 };
}

export function Review() {
  const s = session.value!;
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const plain = useRef<ImageBitmap | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [cursor, setCursor] = useState(-1);
  const [fit, setFit] = useState({ w: 0, h: 0 });
  const press = useRef<{ timer: number; x: number; y: number } | null>(null);

  const base = s.frames.find((f) => f.id === s.baseFrameId)!;
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
    const pz = Panzoom(el, { maxScale: 8, minScale: 1 });
    const parent = holder.current!;
    parent.addEventListener('wheel', pz.zoomWithWheel);
    return () => { parent.removeEventListener('wheel', pz.zoomWithWheel); pz.destroy(); };
  }, []);

  const bmp = comparing.value ? plain.current : previewBitmap.value;
  useEffect(() => {
    const c = canvas.current;
    const b = comparing.value && plain.current ? plain.current : previewBitmap.value;
    if (!c || !b) return;
    c.width = b.width;
    c.height = b.height;
    c.getContext('2d')!.drawImage(b, 0, 0);
  }, [bmp, comparing.value, previewBitmap.value]);

  const down = (e: PointerEvent) => {
    const t = window.setTimeout(async () => {
      plain.current?.close();
      plain.current = await plainBase();
      comparing.value = true;
    }, LONG_PRESS_MS);
    press.current = { timer: t, x: e.clientX, y: e.clientY };
  };
  const move = (e: PointerEvent) => {
    const p = press.current;
    if (p && !comparing.value && Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_SLOP) { clearTimeout(p.timer); press.current = null; }
  };
  const up = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
    comparing.value = false;
  };

  const amber = new Set(attentionPeople(s));
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
        <button class="rounded-lg border px-3 py-1.5 text-sm" onClick={startOver}>Start over</button>
        <button class="rounded-lg border border-amber-400 px-3 py-1.5 text-sm disabled:opacity-40" disabled={!amber.size} onClick={next}>
          Next to check ({amber.size})
        </button>
        <button class="rounded-lg bg-orange-500 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50" disabled={saving.value} onClick={saveResult}>
          {saving.value ? 'Saving…' : 'Save'}
        </button>
      </div>
      <div ref={holder} class="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-neutral-900" style={{ touchAction: 'none' }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up}>
        <div ref={stage} class="relative" style={{ width: `${fit.w}px`, height: `${fit.h}px` }}>
          <canvas ref={canvas} class="h-full w-full select-none" />
          {!comparing.value && s.people.map((p) => {
            const pos = facePos(s, p.id)!;
            const b = badgeFor(s, p.id, amber.has(p.id));
            return (
              <button
                key={p.id}
                aria-label={`Person ${p.id}`}
                class={`absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-sm shadow ${b.cls}`}
                style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                onClick={() => setOpen(p.id)}
              >
                {b.icon}
              </button>
            );
          })}
          {comparing.value && <div class="absolute left-2 top-2 rounded bg-black/60 px-2 py-1 text-xs text-white">Original</div>}
        </div>
      </div>
      <BaseStrip session={s} onPick={(id) => void setBase(id)} />
      {open && <FaceSheet key={open} personId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
