export type Mat3 = [number, number, number, number, number, number, number, number, number];
export type Pt = [number, number];
export interface Box { x: number; y: number; w: number; h: number }

export interface Frame {
  id: string;
  name: string;
  blobKey: string;
  width: number;
  height: number;
  toRef: Mat3;
  alignInliers: number;
  /** sampled inlier matches [x, y, refX, refY] in full-res coords of this frame / the reference frame */
  matches?: [number, number, number, number][];
  exif: Record<string, unknown>;
  jpegQuality?: number;
}

export interface FaceScore { eyes: number; gaze: number; pose: number; smile: number; sharp: number; total: number }

export interface Face {
  id: string;
  frameId: string;
  landmarks: Pt[];
  refLandmarks: Pt[];
  box: Box;
  refBox: Box;
  blend: Record<string, number>;
  pose: { yaw: number; pitch: number; roll: number };
  sharpness: number;
  score: FaceScore;
  thumbKey: string;
}

export interface Person { id: string; faces: Record<string, string> }

export type SwapMode = 'eyes' | 'face';
export interface Pick { personId: string; faceId: string; mode: SwapMode | 'base'; auto: boolean }

export interface Session {
  frames: Frame[];
  faces: Record<string, Face>;
  people: Person[];
  refFrameId: string;
  baseFrameId: string;
  picks: Record<string, Pick>;
}

export type PipelineEvent =
  | { type: 'loaded'; count: number; megapixels: number }
  | { type: 'detected'; frame: number; total: number; faces: number }
  | { type: 'thumb'; faceId: string; frameId: string; blink: boolean; away: boolean; funny: boolean }
  | { type: 'aligned'; frame: number; total: number; inliers: number; fallback?: boolean }
  | { type: 'grouped'; people: number; frames: number; session: Session }
  | { type: 'base'; frame: number; swaps: number }
  | { type: 'warn'; message: string }
  | { type: 'progress'; percent: number };
