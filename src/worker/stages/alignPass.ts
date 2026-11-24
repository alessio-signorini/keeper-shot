import { chooseFrameTransform } from '../../core/faceAlignment';
import { applyAll, boxOf } from '../../core/geometry';
import { facesOfFrame, frameById } from '../../core/session';
import type { Face, Frame, PipelineEvent } from '../../types';
import { BackgroundAligner, type AlignFeatures } from '../lib/orb';

/**
 * Pass 2 — align every frame to the reference frame. Background (ORB) alignment first, then per frame keep it or
 * the face-based transform, whichever lines up more faces. Sets each frame's toRef/alignMethod/alignInliers/matches
 * and maps every face into reference coords (refLandmarks, refBox).
 */
export async function alignPass(
  frames: Frame[],
  faces: Record<string, Face>,
  alignFeatures: AlignFeatures[],
  refIndex: number,
  baseUrl: string,
  emit: (e: PipelineEvent) => void,
  progress: { from: number; span: number },
): Promise<void> {
  const n = frames.length;
  const backgroundAligned = new Map<number, { fallback: boolean }>();
  try {
    const aligner = await BackgroundAligner.create(baseUrl, alignFeatures[refIndex], frames[refIndex].width);
    try {
      for (let i = 0; i < n; i++) {
        if (i !== refIndex) {
          const r = await aligner.align(alignFeatures[i], frames[i].width);
          frames[i].toRef = r.toRef;
          frames[i].alignInliers = r.inliers;
          frames[i].matches = r.matches;
          backgroundAligned.set(i, { fallback: r.fallback || r.identity });
        }
        emit({ type: 'progress', percent: progress.from + (progress.span * (i + 1)) / n });
      }
    } finally {
      aligner.dispose();
    }
  } catch (err) {
    emit({ type: 'warn', message: `Background alignment unavailable (${(err as Error).message})` });
  }

  const refFaces = facesOfFrame(faces, frames[refIndex].id);
  for (let i = 0; i < n; i++) {
    if (i === refIndex) continue;
    const frame = frames[i];
    const own = facesOfFrame(faces, frame.id);
    const choice = chooseFrameTransform(frame.toRef, own, refFaces);
    frame.toRef = choice.toRef;
    frame.alignMethod = choice.method;
    if (choice.byFaces) {
      emit({
        type: 'aligned',
        frame: i + 1,
        total: n,
        inliers: frame.alignInliers,
        byFaces: { matched: choice.byFaces.matched, of: own.length },
      });
    } else if (!backgroundAligned.has(i)) {
      emit({ type: 'warn', message: `Photo ${i + 1}: could not align, using identity` });
    } else {
      emit({
        type: 'aligned',
        frame: i + 1,
        total: n,
        inliers: frame.alignInliers,
        fallback: backgroundAligned.get(i)!.fallback,
      });
    }
  }

  for (const f of Object.values(faces)) {
    f.refLandmarks = applyAll(frameById(frames, f.frameId).toRef, f.landmarks);
    f.refBox = boxOf(f.refLandmarks);
  }
}
