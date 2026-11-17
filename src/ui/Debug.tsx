import { useEffect, useRef, useState } from 'preact/hooks';
import { get } from 'idb-keyval';
import { loadSession } from '../db';
import { maskPolygons } from '../worker/composite';
import { apply, center, invert } from '../core/geometry';
import { isSwap } from '../core/select';
import type { Session } from '../types';

type Layer = 'landmarks' | 'boxes' | 'masks' | 'matches';
const LAYERS: Layer[] = ['landmarks', 'boxes', 'masks', 'matches'];

export function Debug() {
  const [s, setS] = useState<Session | null>(null);
  const [frameId, setFrameId] = useState('f0');
  const [on, setOn] = useState<Record<Layer, boolean>>({ landmarks: true, boxes: true, masks: false, matches: false });
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => { void loadSession().then((x) => x && setS(x)); }, []);

  useEffect(() => {
    if (!s) return;
    const frame = s.frames.find((f) => f.id === frameId);
    if (!frame) return;
    let live = true;
    void (async () => {
      const blob = await get<Blob>(frame.blobKey);
      if (!blob || !live) return;
      const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      const c = canvas.current!;
      c.width = bmp.width;
      c.height = bmp.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      bmp.close();
      const personOf = (faceId: string) => s.people.find((p) => Object.values(p.faces).includes(faceId))?.id ?? '?';
      const lw = Math.max(2, c.width / 800);
      if (on.matches && frame.matches?.length) {
        // each inlier: point in this frame → where the reference frame's point lands in this frame
        const fromRef = invert(frame.toRef);
        ctx.lineWidth = lw;
        for (const [x, y, rx, ry] of frame.matches) {
          const [ex, ey] = apply(fromRef, [rx, ry]);
          ctx.strokeStyle = '#22c55e';
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
          ctx.fillStyle = '#eab308';
          ctx.beginPath(); ctx.arc(x, y, lw * 1.5, 0, 7); ctx.fill();
        }
      }
      for (const face of Object.values(s.faces).filter((f) => f.frameId === frameId)) {
        if (on.landmarks) {
          ctx.fillStyle = '#22d3ee';
          for (const [x, y] of face.landmarks) ctx.fillRect(x - lw / 2, y - lw / 2, lw, lw);
        }
        if (on.boxes) {
          ctx.strokeStyle = '#f97316';
          ctx.lineWidth = lw;
          ctx.strokeRect(face.box.x, face.box.y, face.box.w, face.box.h);
          ctx.fillStyle = '#f97316';
          ctx.font = `${Math.round(face.box.h * 0.2)}px sans-serif`;
          ctx.fillText(personOf(face.id), face.box.x, face.box.y - lw);
        }
        const pick = Object.values(s.picks).find((p) => p.faceId === face.id && isSwap(p));
        if (on.masks && pick && (pick.mode === 'eyes' || pick.mode === 'face')) {
          ctx.strokeStyle = '#a855f7';
          for (const { poly } of maskPolygons(face.landmarks, pick.mode)) {
            ctx.beginPath();
            poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
            ctx.closePath();
            ctx.stroke();
          }
        }
      }
    })();
    return () => { live = false; };
  }, [s, frameId, on]);

  if (!s) return <div class="p-4">No session found. Process a burst first.</div>;
  const faces = Object.values(s.faces).filter((f) => f.frameId === frameId);
  const frame = s.frames.find((f) => f.id === frameId)!;
  return (
    <div class="space-y-3 p-3 text-sm">
      <div class="flex flex-wrap items-center gap-3">
        <select class="rounded border p-1" value={frameId} onChange={(e) => setFrameId((e.target as HTMLSelectElement).value)}>
          {s.frames.map((f) => <option key={f.id} value={f.id}>{f.id} — {f.name}{f.id === s.refFrameId ? ' (ref)' : ''}{f.id === s.baseFrameId ? ' (base)' : ''}</option>)}
        </select>
        {LAYERS.map((l) => (
          <label key={l} class="flex items-center gap-1">
            <input type="checkbox" checked={on[l]} onChange={() => setOn({ ...on, [l]: !on[l] })} /> {l}
          </label>
        ))}
        <a class="underline" href="#">back</a>
      </div>
      <div class="text-neutral-600">aligned by: {frame.alignMethod ?? 'orb'} · background inliers: {frame.alignInliers} · toRef: [{frame.toRef.map((v) => v.toFixed(3)).join(', ')}]</div>
      <canvas ref={canvas} class="w-full max-w-4xl bg-neutral-200" />
      <table class="w-full max-w-4xl text-left">
        <thead><tr><th>face</th><th>person</th><th>eyes</th><th>gaze</th><th>pose</th><th>smile</th><th>sharp</th><th>total</th><th>center</th></tr></thead>
        <tbody>
          {faces.map((f) => (
            <tr key={f.id}>
              <td>{f.id}</td>
              <td>{s.people.find((p) => Object.values(p.faces).includes(f.id))?.id}</td>
              {(['eyes', 'gaze', 'pose', 'smile', 'sharp', 'total'] as const).map((k) => <td key={k}>{f.score[k].toFixed(2)}</td>)}
              <td>{center(f.box).map((v) => Math.round(v)).join(',')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
