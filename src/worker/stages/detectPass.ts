import * as C from '../../config';
import { iou } from '../../core/geometry';
import { dropSmallOutliers } from '../../core/detectionFilters';
import { searchRegion } from '../../core/detectionTiles';
import { quickFlags } from '../../core/scoring';
import { faceThumbKey, frameThumbKey, putBlob } from '../../storage';
import type { Box, Face, Frame, PipelineEvent } from '../../types';
import { decodeBlob, fitSize, scaledCanvas } from '../lib/decode';
import { faceThumb, sharpnessOf } from '../lib/faceCrops';
import { closeDetector, detectFaces, initDetector, refineFace, type DetectedFace } from '../lib/mediapipe';
import { maskBoxes, toGray, type AlignFeatures } from '../lib/orb';
import type { IngestedFile } from './ingest';

const BLANK_SCORE = { eyes: 0, gaze: 0, pose: 0, smile: 0, sharp: 0, total: 0 };

const scaleBox = (b: Box, k: number): Box => ({ x: b.x * k, y: b.y * k, w: b.w * k, h: b.h * k });

export interface DetectPassResult {
  /** unscored faces, keyed `${frameId}:${index}`, landmarks in full-res frame coords */
  faces: Record<string, Face>;
  /** per frame, in frame order: grayscale + face masks for background alignment */
  alignFeatures: AlignFeatures[];
}

/**
 * Pass 1 — for each frame, one full-res bitmap at a time: store the original, decode, scan for faces at working
 * resolution, verify each candidate on a full-res crop, store thumbnails, and keep downscaled grayscale for alignment.
 * Fills in each frame's width/height.
 */
export async function detectPass(
  frames: Frame[],
  infos: IngestedFile[],
  baseUrl: string,
  emit: (e: PipelineEvent) => void,
  progressSpan: number,
): Promise<DetectPassResult> {
  emit({ type: 'status', message: 'Loading face detector…' });
  await initDetector(baseUrl);
  emit({ type: 'status', message: 'Face detector ready' });
  const faces: Record<string, Face> = {};
  const alignFeatures: AlignFeatures[] = [];
  const n = frames.length;
  let prevWorkBoxes: Box[] = [];
  for (let i = 0; i < n; i++) {
    const frame = frames[i];
    if (i === 0) emit({ type: 'status', message: 'Saving photo 1…' });
    await putBlob(frame.blobKey, infos[i].file.blob);
    if (i === 0) emit({ type: 'status', message: 'Decoding photo 1…' });
    const bmp = await decodeBlob(infos[i].file.blob, baseUrl);
    try {
      frame.width = bmp.width;
      frame.height = bmp.height;
      if (i === 0) emit({ type: 'loaded', count: n, megapixels: Math.round((bmp.width * bmp.height) / 1e5) / 10 });

      const work = fitSize(bmp.width, bmp.height, C.WORK_LONG_EDGE);
      const workCanvas = scaledCanvas(bmp, work.w, work.h);
      const candidates = await detectFaces(workCanvas, searchRegion(prevWorkBoxes, work.w, work.h));
      const detected: DetectedFace[] = [];
      for (const c of candidates) {
        const r = await refineFace(bmp, scaleBox(c.box, 1 / work.s));
        if (r && !detected.some((q) => iou(q.box, r.box) > C.TILE_MERGE_IOU)) detected.push(r);
      }
      const kept = dropSmallOutliers(detected).sort((a, b) => a.box.x - b.box.x);
      prevWorkBoxes = kept.map((r) => scaleBox(r.box, work.s));

      const ids: string[] = [];
      for (let k = 0; k < kept.length; k++) {
        const r = kept[k];
        const id = `${frame.id}:${k}`;
        faces[id] = {
          id,
          frameId: frame.id,
          landmarks: r.landmarks,
          refLandmarks: r.landmarks,
          box: r.box,
          refBox: r.box,
          blend: r.blend,
          pose: r.pose,
          sharpness: sharpnessOf(bmp, r.box),
          score: { ...BLANK_SCORE },
          thumbKey: faceThumbKey(id),
        };
        ids.push(id);
        await putBlob(faceThumbKey(id), await faceThumb(bmp, r.box));
        emit({ type: 'thumb', faceId: id, frameId: frame.id, ...quickFlags(r.blend, r.pose) });
      }

      const thumb = fitSize(bmp.width, bmp.height, C.THUMB_PX);
      const thumbBlob = await scaledCanvas(bmp, thumb.w, thumb.h).convertToBlob({
        type: 'image/jpeg',
        quality: C.THUMB_QUALITY,
      });
      await putBlob(frameThumbKey(frame.id), thumbBlob);
      emit({ type: 'detected', frame: i + 1, total: n, faces: ids.length });

      const align = fitSize(bmp.width, bmp.height, C.ALIGN_LONG_EDGE);
      alignFeatures.push({
        w: align.w,
        h: align.h,
        gray: toGray(scaledCanvas(bmp, align.w, align.h)),
        masks: maskBoxes(
          ids.map((id) => faces[id].box),
          align.s,
        ),
      });
    } finally {
      bmp.close();
    }
    emit({ type: 'progress', percent: (progressSpan * (i + 1)) / n });
  }
  // free the model's WASM heap before OpenCV loads
  closeDetector();
  return { faces, alignFeatures };
}
