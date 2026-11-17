export const APP_NAME = 'KeeperShot';
export const ACCENT = '#f97316';

// Ingest
export const MIN_FILES = 2;
export const MAX_FILES = 20;
export const WORK_LONG_EDGE = 2048;
export const ALIGN_LONG_EDGE = 1024;
export const THUMB_PX = 160;
export const THUMB_QUALITY = 0.8;
export const JPEG_QUALITY_MIN = 0.85;
export const JPEG_QUALITY_MAX = 0.97;
export const JPEG_QUALITY_FALLBACK = 0.92;

// Detect
export const MAX_FACES = 50;
// Hundreds of tiny tile inferences: CPU (XNNPACK) is ~7x faster than WebGL here, where GPU readback dominates
export const DETECT_DELEGATE: 'CPU' | 'GPU' = 'CPU';
export const MIN_FACE_CONFIDENCE = 0.5; // full-res verification (refineFace)
export const REFINE_PRESENCE = 0.9; // landmark model's "this is a face" score required in verification (rejects feet, patterns)
export const SCAN_CONFIDENCE = 0.35; // tile scan: permissive, false hits are rejected by the verification pass
export const MIN_FACE_PX = 12; // absolute floor (working-res px)
export const MIN_FACE_FRAC = 0.014; // smallest face searched for, as a fraction of the long edge (~1.8% in a 50-person group shot)
export const TILE_PER_FACE = 6; // the detector finds faces covering ~1/6 of its input
export const TILE_COARSEST_FRAC = 0.32;
export const TILE_STEP = 0.6; // ratio between successive tile sizes
export const TILE_REGION_BELOW = 0.2; // tiles smaller than this × long edge only scan the group region (after frame 1)
export const TILE_REGION_MARGIN = 0.12;
export const TILE_REGION_MIN_FACES = 3;
export const TILE_OVERLAP = 0.25;
export const TILE_MERGE_IOU = 0.5;
export const REFINE_CONTEXT = 2.5; // crop side / face size for the full-res verification pass
export const MIN_REL_FACE = 0.65; // drop faces smaller than this × the frame's median face (feet, patterns, distant passers-by)
export const MIN_REL_SHARPNESS = 0.15; // drop people whose median face sharpness is below this × the median person's
export const MIN_REL_FACE_COUNT = 5; // only when the frame has at least this many faces
export const GAZE_SATURATED = 0.93;
export const GAZE_SATURATED_MAX = 2; // reject a "face" with this many gaze blendshapes above GAZE_SATURATED
export const REFINE_PX = 512;
export const REFINE_MIN_PX = 192; // upsample tiny crops so the landmarker gets enough pixels
export const REFINE_MIN_IOU = 0.3;
export const SHARPNESS_CROP_PX = 128;

// Align
export const ORB_FEATURES = 5000;
export const ALIGN_MIN_INLIERS = 40;
export const LOWE_RATIO = 0.75;
export const RANSAC_THRESHOLD = 3;
export const ALIGN_MASK_WIDE = 1.5;
export const ALIGN_MASK_TALL = 3;
export const ALIGN_PERSPECTIVE_MAX = 0.002;
export const ALIGN_SCALE_MIN = 0.8;
export const ALIGN_SCALE_MAX = 1.25;
export const DEBUG_MAX_MATCHES = 150;
// Face-based alignment (used when it lines up more faces than background alignment)
export const FACE_ALIGN_MIN_FACES = 3;
export const FACE_ALIGN_TOL = 0.35; // face widths: a face "lines up" if its centre lands this close
export const FACE_ALIGN_SEED_TOL = 0.5;
export const FACE_ALIGN_REFINE_TOLS = [0.6, 0.6, 0.35, 0.35];
export const FACE_ALIGN_TOP = 10;

// Photos where fewer than this fraction of the reference's faces line up are left out of the session
export const FRAME_MIN_ALIGNED = 0.6;
export const FRAME_MIN_KEPT = 4;

// Group
export const GROUP_MIN_IOU = 0.3;
export const GROUP_MIN_FRAME_FRACTION = 0.25;
export const GROUP_CENTER_WEIGHT = 0.5;
export const GROUP_MAX_DIST = 0.75; // face widths: also match a face this close to a person's mean position
export const GROUP_MERGE_BASE = 1.0; // face widths: fragments in different frames merge within BASE + PER_FRAME × frame gap
export const GROUP_MERGE_PER_FRAME = 0.8;

// Score
export const SCORE_WEIGHTS = { eyes: 0.4, gaze: 0.2, pose: 0.15, smile: 0.15, sharp: 0.1 };
export const BLINK_THRESHOLD = 0.5;
export const BLINK_PENALTY = 0.3;
export const BLINK_REL = 0.7; // blink if eyes < 70% of the person's best eyes score
export const POSE_RANGE_DEG = 40;
export const JAW_OPEN_FREE = 0.5;
export const FUNNY_FREE = 0.5;
export const LOW_CONFIDENCE_TOTAL = 0.6;

// Swap
export const EYES_MAX_DPOSE = 6;
export const EYES_MAX_RESIDUAL = 0.04;
export const FACE_MAX_DPOSE = 15;
export const FACE_MAX_RESIDUAL = 0.08;
export const SWAP_GAIN_MIN = 0.02; // swap whenever a feasible face scores clearly better
export const WIN_EPSILON = 0.02; // faces this close to a person's best count as "best" for base choice
export const SMILE_SIMILAR = 0.1;

// Composite
export const ROI_SCALE = 1.6;
export const ROI_MARGIN = 0.3;
export const FACE_FOREHEAD_RAISE = 0.15;
export const FACE_JAW_ERODE = 0.03;
export const FACE_FEATHER = 0.08;
export const EYES_DILATE = 0.25;
export const EYES_FEATHER = 0.3;
export const PYRAMID_LEVELS = 5;
export const USE_POISSON = false;
export const PREVIEW_LONG_EDGE = 1600;

// Progress weights (percent)
export const PROGRESS = { decode: 10, detect: 40, align: 30, group: 5, preview: 15 };
export const AUTO_ADVANCE_MS = 1000;
