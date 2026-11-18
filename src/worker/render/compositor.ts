import { applyAll, boxOf, invert } from '../../core/geometry';
import { maskPolygons, skinPolygons } from '../../core/masks';
import { isSwap, type PicksByPerson } from '../../core/picks';
import { placeSwap, planIncrementalUpdate, swapKey, type SwapPlacement, type SwapRegion } from '../../core/placement';
import type { Box, FacePick, Mat3, Pt, Session } from '../../types';
import { withMats, withMatsSync, type CV } from '../lib/opencv';
import { blendPatch } from './blend';

/** Extra source pixels around the warp footprint so the Lanczos kernel has its full support. */
const LANCZOS_MARGIN = 4;
/** Swaps whose ROI is smaller than this (px per side) are skipped. */
const MIN_ROI_PX = 8;

/** Returns a bitmap of a frame already at the compositor's scale. */
export type FrameSource = (frameId: string) => Promise<ImageBitmap>;

export interface UpdateOpts {
  /** required whenever a pick is a swap */
  cv: CV | null;
  source: FrameSource;
  /** called when a source bitmap is no longer needed */
  release?: (frameId: string, bmp: ImageBitmap) => void;
}

/**
 * Holds a composite canvas and applies pick changes incrementally: only the regions touched by changed
 * picks (plus any overlapping picks) are restored from the base and re-blended, in stable person order.
 */
export class Compositor {
  readonly canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;
  /** untouched base pixels for restoring dirty regions; null for one-shot renders */
  private baseCopy: OffscreenCanvas | null = null;
  private applied = new Map<string, SwapRegion>();

  constructor(
    readonly baseId: string,
    /** output pixels per full-res pixel */
    readonly scale: number,
    base: ImageBitmap,
    restorable: boolean,
  ) {
    this.canvas = new OffscreenCanvas(base.width, base.height);
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
    this.ctx.drawImage(base, 0, 0);
    if (restorable) {
      this.baseCopy = new OffscreenCanvas(base.width, base.height);
      this.baseCopy.getContext('2d')!.drawImage(base, 0, 0);
    }
  }

  async update(session: Session, picks: PicksByPerson, opts: UpdateOpts): Promise<void> {
    const order = new Map(session.people.map((p, i) => [p.id, i]));
    const wanted = new Map<string, { pick: FacePick; placement: SwapPlacement }>();
    for (const p of Object.values(picks)) {
      if (!isSwap(p)) continue;
      wanted.set(p.personId, {
        pick: p,
        placement: placeSwap(session, p, this.scale, this.canvas.width, this.canvas.height),
      });
    }
    const wantedRegions = new Map([...wanted].map(([id, w]) => [id, { key: swapKey(w.pick), roi: w.placement.roi }]));
    const { dirty, redo } = planIncrementalUpdate(this.applied, wantedRegions);

    if (this.baseCopy) {
      for (const r of dirty) this.ctx.drawImage(this.baseCopy, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
    }
    for (const id of [...this.applied.keys()]) {
      if (!wanted.has(id) || redo.has(id)) this.applied.delete(id);
    }

    // one source decode per frame: group the swaps to redo by source frame
    const byFrame = new Map<string, string[]>();
    for (const id of [...redo].sort((x, y) => order.get(x)! - order.get(y)!)) {
      const frameId = session.faces[wanted.get(id)!.pick.faceId].frameId;
      byFrame.set(frameId, [...(byFrame.get(frameId) ?? []), id]);
    }
    for (const [frameId, ids] of byFrame) {
      const bmp = await opts.source(frameId);
      try {
        for (const id of ids) {
          const { pick, placement } = wanted.get(id)!;
          await applySwap(opts.cv!, this.ctx, bmp, placement, pick.mode as 'face' | 'eyes');
          this.applied.set(id, wantedRegions.get(id)!);
        }
      } finally {
        opts.release?.(frameId, bmp);
      }
    }
  }
}

/** One-shot full render (export): no restore copy is kept, and the base bitmap is released right after drawing. */
export async function renderComposite(
  session: Session,
  picks: PicksByPerson,
  opts: UpdateOpts & { scale: number; base: ImageBitmap; releaseBase?: () => void },
): Promise<OffscreenCanvas> {
  const comp = new Compositor(session.baseFrameId, opts.scale, opts.base, false);
  opts.releaseBase?.();
  await comp.update(session, picks, opts);
  return comp.canvas;
}

/** Lanczos warp of only the source region the ROI needs; alpha marks where the source covers the ROI. */
function warpPatch(cv: CV, srcBmp: ImageBitmap, srcToOut: Mat3, roi: Box): ImageData {
  const corners = applyAll(invert(srcToOut), [
    [roi.x, roi.y],
    [roi.x + roi.w, roi.y],
    [roi.x, roi.y + roi.h],
    [roi.x + roi.w, roi.y + roi.h],
  ]);
  const bb = boxOf(corners);
  const sx = Math.max(0, Math.floor(bb.x) - LANCZOS_MARGIN);
  const sy = Math.max(0, Math.floor(bb.y) - LANCZOS_MARGIN);
  const sw = Math.min(srcBmp.width, Math.ceil(bb.x + bb.w) + LANCZOS_MARGIN) - sx;
  const sh = Math.min(srcBmp.height, Math.ceil(bb.y + bb.h) + LANCZOS_MARGIN) - sy;
  if (sw < 2 || sh < 2) return new ImageData(roi.w, roi.h);
  const crop = new OffscreenCanvas(sw, sh);
  const cctx = crop.getContext('2d', { willReadFrequently: true })!;
  cctx.drawImage(srcBmp, sx, sy, sw, sh, 0, 0, sw, sh);
  const img = cctx.getImageData(0, 0, sw, sh);
  const T = srcToOut;
  return withMatsSync((t) => {
    const src = t.add(cv.matFromImageData(img));
    const dst = t.add(new cv.Mat());
    // crop coords → ROI coords
    const M = t.add(
      cv.matFromArray(2, 3, cv.CV_64F, [
        T[0],
        T[1],
        T[0] * sx + T[1] * sy + T[2] - roi.x,
        T[3],
        T[4],
        T[3] * sx + T[4] * sy + T[5] - roi.y,
      ]),
    );
    const size = new cv.Size(roi.w, roi.h);
    cv.warpAffine(src, dst, M, size, cv.INTER_LANCZOS4, cv.BORDER_CONSTANT, new cv.Scalar(0, 0, 0, 0));
    return new ImageData(new Uint8ClampedArray(dst.data), roi.w, roi.h);
  });
}

/** Rasterises polygons (output coords) into an ROI-sized canvas: black background, each polygon in its colour. */
function rasterize(
  ctx: OffscreenCanvasRenderingContext2D,
  roi: Box,
  polys: { poly: Pt[]; color: string }[],
): ImageData {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, roi.w, roi.h);
  for (const { poly, color } of polys) {
    ctx.fillStyle = color;
    ctx.beginPath();
    poly.forEach((p, i) => (i ? ctx.lineTo(p[0] - roi.x, p[1] - roi.y) : ctx.moveTo(p[0] - roi.x, p[1] - roi.y)));
    ctx.closePath();
    ctx.fill();
  }
  return ctx.getImageData(0, 0, roi.w, roi.h);
}

async function applySwap(
  cv: CV,
  ctx: OffscreenCanvasRenderingContext2D,
  srcBmp: ImageBitmap,
  placement: SwapPlacement,
  mode: 'face' | 'eyes',
): Promise<void> {
  const { srcToOut, mapped, roi } = placement;
  if (roi.w < MIN_ROI_PX || roi.h < MIN_ROI_PX) return;
  const polys = maskPolygons(mapped, mode);
  const patchData = warpPatch(cv, srcBmp, srcToOut, roi);

  const mctx = new OffscreenCanvas(roi.w, roi.h).getContext('2d', { willReadFrequently: true })!;
  // hard mask (white on black), feathered later
  const maskData = rasterize(
    mctx,
    roi,
    polys.map(({ poly }) => ({ poly, color: '#fff' })),
  );
  let skinData: ImageData | undefined;
  if (mode === 'face') {
    const skin = skinPolygons(mapped);
    skinData = rasterize(mctx, roi, [
      { poly: skin.include, color: '#fff' },
      ...skin.exclude.map((poly) => ({ poly, color: '#000' })),
    ]);
  }
  const baseData = ctx.getImageData(roi.x, roi.y, roi.w, roi.h);
  const feather = Math.max(...polys.map((p) => p.feather));
  const out = await withMats((t) => blendPatch(cv, t, baseData, patchData, maskData, feather, skinData));
  ctx.putImageData(out, roi.x, roi.y);
}
