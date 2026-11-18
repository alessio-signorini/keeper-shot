// OpenCV.js ships without usable typings.
export type CV = any;

/**
 * Module workers have no importScripts, but MediaPipe's loader and the OpenCV UMD build expect it.
 * Shim it with a synchronous fetch + global eval so one module worker serves dev and prod.
 */
export function installImportScripts(): void {
  const g = self as unknown as { importScripts?: (...u: string[]) => void };
  try {
    g.importScripts?.(); // classic workers accept an empty call; module workers throw
    return;
  } catch {
    /* module worker */
  }
  g.importScripts = (...urls: string[]) => {
    for (const u of urls) {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', u, false);
      xhr.send();
      if (xhr.status < 200 || xhr.status >= 300) throw new Error(`Failed to load ${u} (${xhr.status})`);
      (0, eval)(`${xhr.responseText}\n//# sourceURL=${u}`);
    }
  };
}

let cvPromise: Promise<CV> | null = null;

/** Lazy-load the self-hosted OpenCV.js (single-threaded WASM) into the worker. */
export function loadCV(baseUrl: string): Promise<CV> {
  if (!cvPromise) {
    cvPromise = (async () => {
      importScripts(new URL('opencv/opencv.js', baseUrl).href);
      // `cv` is thenable until the runtime is initialised; awaiting yields the ready module.
      return await (self as unknown as { cv: unknown }).cv;
    })();
  }
  return cvPromise;
}

/** Tracks Mats/vectors so they can all be released in one `finally`. */
export class Tracker {
  private items: { delete: () => void }[] = [];
  add<T extends { delete: () => void }>(m: T): T {
    this.items.push(m);
    return m;
  }
  dispose() {
    for (const m of this.items.reverse()) {
      try {
        m.delete();
      } catch {
        /* already freed */
      }
    }
    this.items = [];
  }
}

export async function withMats<T>(fn: (t: Tracker) => Promise<T> | T): Promise<T> {
  const t = new Tracker();
  try {
    return await fn(t);
  } finally {
    t.dispose();
  }
}
