import { isSwap, type PicksByPerson } from '../../core/picks';
import { baseFrame, frameById } from '../../core/session';
import type { Frame, Session } from '../../types';
import { exportFileName, encodeJpeg } from '../lib/jpegEncode';
import { loadCV } from '../lib/opencv';
import { Compositor, renderComposite } from './compositor';
import { decodeFrame, FrameCache, frameBlob } from './frameCache';

/** Preview and export rendering. Holds the preview's incremental compositor and frame cache between calls. */
export class Renderer {
  private cache: FrameCache;
  private preview: Compositor | null = null;

  constructor(private baseUrl: () => string) {
    this.cache = new FrameCache(baseUrl);
  }

  /** Drop the preview compositor and cached frames (new burst, or before a full-resolution export). */
  reset(): void {
    this.cache.clear();
    this.preview = null;
  }

  async renderPreview(session: Session, picks: PicksByPerson, longEdge: number): Promise<ImageBitmap> {
    const base = baseFrame(session);
    const scale = previewScale(base, longEdge);
    if (!this.preview || this.preview.baseId !== base.id || this.preview.scale !== scale) {
      this.preview = new Compositor(base.id, scale, await this.cache.get(base, scale), true);
    }
    const cv = Object.values(picks).some(isSwap) ? await loadCV(this.baseUrl()) : null;
    await this.preview.update(session, picks, {
      cv,
      source: (id) => this.cache.get(frameById(session.frames, id), scale),
    });
    return createImageBitmap(this.preview.canvas);
  }

  /** One frame as stored, at preview size (the before/after view). */
  async renderFrame(session: Session, frameId: string, longEdge: number): Promise<ImageBitmap> {
    const f = frameById(session.frames, frameId);
    return createImageBitmap(await this.cache.get(f, previewScale(f, longEdge)));
  }

  async exportJpeg(session: Session, picks: PicksByPerson): Promise<{ blob: Blob; name: string }> {
    // free the preview's bitmaps and canvas: the full-resolution render needs the memory
    this.reset();
    const base = baseFrame(session);
    const baseBmp = await decodeFrame(base, 1, this.baseUrl());
    try {
      const cv = await loadCV(this.baseUrl());
      const canvas = await renderComposite(session, picks, {
        cv,
        scale: 1,
        base: baseBmp,
        source: (id) => decodeFrame(frameById(session.frames, id), 1, this.baseUrl()),
        release: (_id, b) => b.close(),
        releaseBase: () => baseBmp.close(),
      });
      const blob = await encodeJpeg(canvas, base, await frameBlob(base));
      return { blob, name: exportFileName(base.name) };
    } finally {
      baseBmp.close();
    }
  }
}

const previewScale = (f: Frame, longEdge: number) => Math.min(1, longEdge / Math.max(f.width, f.height));
