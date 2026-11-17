/** File → ImageBitmap with EXIF orientation baked in. Falls back to libheif for HEIC. */
export async function decodeBlob(blob: Blob, baseUrl: string): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch (err) {
    if (!isHeic(blob)) throw err;
    return decodeHeic(blob, baseUrl);
  }
}

function isHeic(blob: Blob): boolean {
  const t = blob.type.toLowerCase();
  const n = ((blob as File).name ?? '').toLowerCase();
  return t.includes('heic') || t.includes('heif') || /\.(heic|heif)$/.test(n) || t === '';
}

async function decodeHeic(blob: Blob, baseUrl: string): Promise<ImageBitmap> {
  const url = new URL('libheif/libheif-bundle.mjs', baseUrl).href;
  const mod = (await import(/* @vite-ignore */ url)) as { default: unknown };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lib: any = typeof mod.default === 'function' ? (mod.default as () => unknown)() : mod.default;
  const decoder = new lib.HeifDecoder();
  const images = decoder.decode(new Uint8Array(await blob.arrayBuffer()));
  if (!images?.length) throw new Error('HEIC decode failed');
  const img = images[0];
  const w: number = img.get_width(), h: number = img.get_height();
  const data = new ImageData(w, h);
  await new Promise<void>((resolve, reject) =>
    img.display(data, (d: ImageData | null) => (d ? resolve() : reject(new Error('HEIC display failed')))),
  );
  return createImageBitmap(data);
}

export function fitSize(w: number, h: number, longEdge: number): { w: number; h: number; s: number } {
  const s = Math.min(1, longEdge / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)), s };
}

export function scaledCanvas(src: ImageBitmap | OffscreenCanvas, w: number, h: number): OffscreenCanvas {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  return c;
}
