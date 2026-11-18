import type { PipelineEvent } from '../types';

/** The progress-feed line for a pipeline event, or null for events that only update state. */
export function describeEvent(e: PipelineEvent): string | null {
  switch (e.type) {
    case 'loaded':
      return `Loaded ${e.count} photos (${e.megapixels} MP each)`;
    case 'detected':
      return `Photo ${e.frame}/${e.total}: found ${e.faces} faces`;
    case 'aligned':
      return e.byFaces
        ? `Aligned photo ${e.frame} using faces — ${e.byFaces.matched}/${e.byFaces.of} faces line up`
        : `Aligned photo ${e.frame} — ${e.inliers} matching points${e.fallback ? ' (fallback)' : ''}`;
    case 'grouped':
      return `Grouped ${e.people} people across ${e.frames} photos`;
    case 'base':
      return `Best base: photo ${e.frame} — needs ${e.swaps} fix${e.swaps === 1 ? '' : 'es'}`;
    case 'warn':
      return `⚠ ${e.message}`;
    case 'thumb':
    case 'progress':
      return null;
  }
}
