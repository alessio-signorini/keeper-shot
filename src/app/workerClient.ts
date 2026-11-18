import * as Comlink from 'comlink';
import type { PipelineApi } from '../worker/pipeline.worker';

let worker: Worker | null = null;
let api: Comlink.Remote<PipelineApi> | null = null;

/** The pipeline worker's API, starting a worker on first use. */
export function pipeline(): Comlink.Remote<PipelineApi> {
  if (!api) {
    worker = new Worker(new URL('../worker/pipeline.worker.ts', import.meta.url), { type: 'module' });
    api = Comlink.wrap<PipelineApi>(worker);
    void api.init(new URL(import.meta.env.BASE_URL, location.href).href);
  }
  return api;
}

/** WASM heaps (face model, OpenCV alignment) never shrink; a fresh worker gives that memory back before preview/export. */
export function recycleWorker() {
  worker?.terminate();
  worker = null;
  api = null;
}
