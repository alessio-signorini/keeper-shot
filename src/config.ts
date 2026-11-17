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
export const MIN_FACE_CONFIDENCE = 0.5;
export const MIN_FACE_PX = 40;
export const TILE_SIZES = [640, 400];
export const TILE_OVERLAP = 0.25;
export const TILE_MERGE_IOU = 0.5;
export const REFINE_CONTEXT = 2.5; // crop side / face size for the full-res verification pass
export const REFINE_PX = 512;
export const REFINE_MIN_IOU = 0.3;
export const SHARPNESS_CROP_PX = 128;
export const BIG_IMAGE_PX = 1000;

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

// Group
export const GROUP_MIN_IOU = 0.3;
export const GROUP_MIN_FRAME_FRACTION = 0.25;
export const GROUP_CENTER_WEIGHT = 0.5;

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
export const SWAP_GAIN_MIN = 0.12;
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
