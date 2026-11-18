import exifr from 'exifr';
import * as C from '../../config';
import { IDENTITY } from '../../core/geometry';
import { estimateJpegQuality } from '../../core/jpegQuality';
import { frameBlobKey } from '../../storage';
import type { Frame } from '../../types';

/** Enough of the file to reach the JPEG quantisation tables. */
const JPEG_HEADER_BYTES = 256 * 1024;
/** Undated frames sort after every dated one, in file order. */
const UNDATED_TIME = Number.MAX_SAFE_INTEGER / 2;

export interface InputFile {
  name: string;
  blob: Blob;
}

export interface IngestedFile {
  file: InputFile;
  exif: Record<string, unknown>;
  /** sort key: capture time in ms, or UNDATED_TIME + file order */
  time: number;
  jpegQuality: number;
}

/** Keep only structured-clone/JSON-friendly EXIF values (dates as ISO strings, short numeric arrays). */
function jsonSafe(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v instanceof Date) out[k] = v.toISOString();
    else if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') out[k] = v;
    else if (Array.isArray(v) && v.every((x) => typeof x === 'number') && v.length < 16) out[k] = v;
  }
  return out;
}

async function readFileInfo(file: InputFile, order: number): Promise<IngestedFile> {
  let exif: Record<string, unknown> = {};
  try {
    exif = (await exifr.parse(file.blob, true)) ?? {};
  } catch {
    /* no EXIF */
  }
  const dt = exif.DateTimeOriginal;
  const subSec = Number(exif.SubSecTimeOriginal ?? 0) / 1000 || 0;
  const time = dt instanceof Date ? dt.getTime() + subSec * 1000 : UNDATED_TIME + order;
  const head = new Uint8Array(await file.blob.slice(0, JPEG_HEADER_BYTES).arrayBuffer());
  const jpegQuality = head[0] === 0xff && head[1] === 0xd8 ? estimateJpegQuality(head) : C.JPEG_QUALITY_FALLBACK;
  return { file, exif: jsonSafe(exif), time, jpegQuality };
}

/** Read EXIF and JPEG quality one file at a time (bounded memory), sorted by capture time. */
export async function ingestFiles(files: InputFile[]): Promise<IngestedFile[]> {
  const infos: IngestedFile[] = [];
  for (let i = 0; i < files.length; i++) infos.push(await readFileInfo(files[i], i));
  return infos.sort((a, b) => a.time - b.time);
}

/** A frame before decoding: size, alignment and faces are filled in by later stages. */
export function newFrame(info: IngestedFile, index: number): Frame {
  const id = `f${index}`;
  return {
    id,
    name: info.file.name,
    blobKey: frameBlobKey(id),
    width: 0,
    height: 0,
    toRef: [...IDENTITY],
    alignInliers: 0,
    exif: info.exif,
    jpegQuality: info.jpegQuality,
  };
}
