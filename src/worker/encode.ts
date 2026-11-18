import piexif from 'piexifjs';
import { APP_NAME } from '../config';
import type { Frame } from '../types';

const KEEP_0TH = [271, 272]; // Make, Model
const KEEP_EXIF = [36867, 36881, 37520, 37521, 37522, 33437, 33434, 34855, 37386, 41989, 42036, 40961]; // DateTimeOriginal, OffsetTimeOriginal, SubSec*, FNumber, ExposureTime, ISO, FocalLength, FocalLengthIn35mm, LensModel, ColorSpace

function toBinary(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return s;
}
function fromBinary(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}
function exifDate(v: unknown): string | null {
  const d = typeof v === 'string' ? new Date(v) : v instanceof Date ? v : null;
  if (!d || isNaN(d.getTime())) return null;
  return `${d.getFullYear()}:${pad(d.getMonth() + 1)}:${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

type ExifDict = { [ifd: string]: Record<number, unknown> };

function fromOriginal(original: Blob | null, bytes: Uint8Array | null): ExifDict | null {
  if (!original || !bytes || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  try {
    const src = piexif.load(toBinary(bytes)) as unknown as ExifDict;
    const out: ExifDict = { '0th': {}, Exif: {}, GPS: {}, Interop: {}, '1st': {} };
    for (const k of KEEP_0TH) if (k in src['0th']) out['0th'][k] = src['0th'][k];
    for (const k of KEEP_EXIF) if (k in src.Exif) out.Exif[k] = src.Exif[k];
    out.GPS = { ...src.GPS };
    return out;
  } catch {
    return null;
  }
}

function fromParsed(exif: Record<string, unknown>): ExifDict {
  const d: ExifDict = { '0th': {}, Exif: {}, GPS: {}, Interop: {}, '1st': {} };
  if (typeof exif.Make === 'string') d['0th'][271] = exif.Make;
  if (typeof exif.Model === 'string') d['0th'][272] = exif.Model;
  const dt = exifDate(exif.DateTimeOriginal);
  if (dt) d.Exif[36867] = dt;
  return d;
}

export async function encodeJpeg(canvas: OffscreenCanvas, base: Frame, original: Blob | null): Promise<Blob> {
  const jpeg = await canvas.convertToBlob({ type: 'image/jpeg', quality: base.jpegQuality ?? 0.92 });
  const originalBytes = original ? new Uint8Array(await original.slice(0, 4 * 1024 * 1024).arrayBuffer()) : null;
  const dict = fromOriginal(original, originalBytes) ?? fromParsed(base.exif);
  dict['0th'][274] = 1; // orientation already baked into pixels
  dict['0th'][305] = APP_NAME;
  dict.Exif[40962] = canvas.width;
  dict.Exif[40963] = canvas.height;
  const build = (d: ExifDict) => piexif.dump(d as never);
  let exifStr: string;
  try {
    exifStr = build(dict);
  } catch {
    exifStr = build({ ...fromParsed(base.exif), '0th': { ...fromParsed(base.exif)['0th'], 274: 1, 305: APP_NAME } });
  }
  const bytes = new Uint8Array(await jpeg.arrayBuffer());
  const withExif = piexif.insert(exifStr, toBinary(bytes));
  return new Blob([fromBinary(withExif) as BlobPart], { type: 'image/jpeg' });
}

export function exportName(frameName: string): string {
  return `${frameName.replace(/\.[^.]+$/, '')}-keepershot.jpg`;
}
