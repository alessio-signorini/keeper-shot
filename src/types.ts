/** 3×3 row-major homogeneous transform. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];
export type Pt = [number, number];
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Everything below is persisted in IndexedDB as part of `Session` (Resume): reshaping fields breaks saved sessions.

/** One photo of the burst. */
export interface Frame {
  /** `f<index>` in capture-time order */
  id: string;
  /** original file name */
  name: string;
  /** IndexedDB key of the original file */
  blobKey: string;
  /** full resolution, EXIF orientation applied */
  width: number;
  height: number;
  /** this frame's full-res px → reference frame's full-res px (identity for the reference frame) */
  toRef: Mat3;
  /** background (ORB) alignment inliers; 0 for the reference frame or when background alignment failed */
  alignInliers: number;
  /** which transform became toRef: background feature matches, or the faces themselves */
  alignMethod?: 'orb' | 'faces';
  /** sampled inlier matches [x, y, refX, refY] in full-res coords of this frame / the reference frame */
  matches?: [number, number, number, number][];
  /** JSON-safe EXIF of the original */
  exif: Record<string, unknown>;
  /** estimated quality of the original JPEG (0..1), reused for export */
  jpegQuality?: number;
}

/** Quality components in 0..1; `total` is their weighted sum (SCORE_WEIGHTS), × BLINK_PENALTY on a blink. */
export interface FaceScore {
  eyes: number;
  gaze: number;
  pose: number;
  smile: number;
  sharp: number;
  total: number;
}

/** One detected face in one frame. */
export interface Face {
  /** `${frameId}:${index}`, index left to right */
  id: string;
  frameId: string;
  /** 478 MediaPipe landmarks, full-res frame px */
  landmarks: Pt[];
  /** the same landmarks mapped into reference-frame px (via the frame's toRef) */
  refLandmarks: Pt[];
  /** landmark bounding box, full-res frame px */
  box: Box;
  refBox: Box;
  /** MediaPipe blendshape scores by name (eyeBlinkLeft, mouthSmileRight, …) */
  blend: Record<string, number>;
  /** head pose, degrees */
  pose: { yaw: number; pitch: number; roll: number };
  /** raw Laplacian variance of the face crop (higher = sharper) */
  sharpness: number;
  score: FaceScore;
  /** IndexedDB key of the face thumbnail */
  thumbKey: string;
}

/** One person tracked across frames. */
export interface Person {
  /** `p<n>`, numbered left to right */
  id: string;
  /** frameId → faceId (at most one face per frame) */
  faces: Record<string, string>;
}

export type SwapMode = 'eyes' | 'face';
/** 'base' keeps the base frame's face; 'skip' pastes nothing (faceId is ''), leaving the base photo untouched there. */
export type PickMode = SwapMode | 'base' | 'skip';
/** What the composite shows for one person. */
export interface FacePick {
  personId: string;
  /** the face shown ('' for skip) */
  faceId: string;
  mode: PickMode;
  /** chosen automatically (false once the user confirms a choice) */
  auto: boolean;
}

export interface Session {
  frames: Frame[];
  faces: Record<string, Face>;
  people: Person[];
  /** frame every other frame is aligned to (the middle one by time) */
  refFrameId: string;
  /** frame the composite starts from */
  baseFrameId: string;
  /** personId → pick */
  picks: Record<string, FacePick>;
}

/** Progress events the worker sends to the main thread during analysis. */
export type PipelineEvent =
  | { type: 'loaded'; count: number; megapixels: number }
  | { type: 'detected'; frame: number; total: number; faces: number }
  | { type: 'thumb'; faceId: string; frameId: string; blink: boolean; away: boolean; funny: boolean }
  | {
      type: 'aligned';
      frame: number;
      total: number;
      inliers: number;
      fallback?: boolean;
      byFaces?: { matched: number; of: number };
    }
  | { type: 'grouped'; people: number; frames: number; session: Session }
  | { type: 'base'; frame: number; swaps: number }
  | { type: 'warn'; message: string }
  | { type: 'progress'; percent: number };
