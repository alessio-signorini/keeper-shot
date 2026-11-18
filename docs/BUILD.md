# BUILD.md — KeeperShot

The complete build spec and the record of design decisions. Someone (or an LLM) with only this file and an empty repository should be able to rebuild the app. It is kept current: when behaviour changes, edit the matching section (replace outdated statements; never append contradictions). Companion docs: [architecture.md](architecture.md) (module map), [future-work.md](future-work.md) (ideas), [../AGENTS.md](../AGENTS.md) (working rules).

KeeperShot is a client-only PWA that takes a burst of near-identical group photos, finds every face, groups faces into people, picks the best face per person, lets the user review/change the picks, and composites one final photo where everyone looks good. Everything runs in the browser; heavy work runs in one Web Worker. No backend, no analytics, no runtime network calls besides the app's own static assets. Deployed to GitHub Pages.

## 0. Ground rules

- Keep code small. Pure logic goes in `src/core/` with a focused unit test (`tests/unit/<module>.test.ts`); UI stays thin.
- Dependency direction: `ui → app → (worker via Comlink) → core`. `core` imports only `core`, `types` and `config`. `ui` never imports `worker`. `core` has no DOM, canvas, WASM or IndexedDB.
- Tunable thresholds live in `src/config.ts` (section 4). Fixed implementation constants are named `const`s at the top of the file that uses them with a one-line comment. No unnamed numbers in logic.
- MediaPipe landmark indices live only in `src/core/landmarks.ts`.
- Look up frames/people/faces through `src/core/session.ts` (`frameById`, `baseFrame`, `personById`, `faceInFrame`, `facesOfFrame`, `personOfFace`) and IndexedDB keys through `src/storage.ts`.
- Name coordinate spaces in variables when not obvious: full-res frame px, `work*` (WORK_LONG_EDGE), `align*` (ALIGN_LONG_EDGE), `ref*` (reference frame), output/preview px (`scale`).
- `Session` and everything in it is persisted for Resume. Reshaping a persisted field breaks saved sessions unless loading handles the old shape.
- Prettier formatting (`.prettierrc.json`: `printWidth 120`, `singleQuote`, `trailingComma: all`), one statement per line.
- Before finishing any change: `npm run format`, `npm run typecheck`, `npm run test`. Run `npm run e2e` when touching the worker, pipeline or UI flows.

## 1. Stack and platform constraints

| Concern        | Choice                                                                           |
| -------------- | -------------------------------------------------------------------------------- |
| Build          | Vite + TypeScript (strict), ES2022 target, `worker: { format: 'es' }`            |
| UI             | Preact + `@preact/signals` (`@preact/preset-vite`)                               |
| Styling        | Tailwind CSS v4 via `@tailwindcss/vite` (`src/index.css`)                        |
| PWA            | `vite-plugin-pwa` (`registerType: 'autoUpdate'`, generateSW)                     |
| Worker RPC     | `comlink`                                                                        |
| Face landmarks | `@mediapipe/tasks-vision` FaceLandmarker (478 landmarks, blendshapes, transform) |
| CV             | `@techstark/opencv-js` (lazy-loaded in the worker)                               |
| EXIF           | `exifr` (read), `piexifjs` (+ `@types/piexifjs`) (write)                         |
| HEIC           | `libheif-js` (lazy; only when a HEIC fails native decode)                        |
| Persistence    | `idb-keyval`                                                                     |
| Pan/zoom       | `@panzoom/panzoom`                                                               |
| Tests          | Vitest (unit, `tests/unit/**/*.test.ts`), Playwright (e2e)                       |

npm scripts: `dev` (`vite`), `build` (`tsc --noEmit && vite build`), `preview`, `typecheck` (`tsc --noEmit`), `test` (`vitest run`), `e2e` (`playwright test`), `format` (`prettier --write .`), `format:check`. `package.json` has `"private": true`, `"type": "module"`; commit `package-lock.json`.

Platform decisions:

- GitHub Pages can't set COOP/COEP, so `SharedArrayBuffer` is unavailable: use only the single-threaded WASM builds. Never require cross-origin isolation.
- Everything is self-hosted and precached by the service worker, so the app works offline after the first load. `vite-plugin-static-copy` copies (flattened, `rename: { stripBase: true }`) `node_modules/@mediapipe/tasks-vision/wasm/*` → `dist/mediapipe-wasm`, `@techstark/opencv-js/dist/opencv.js` → `dist/opencv`, `libheif-js/libheif-wasm/libheif-bundle.mjs` → `dist/libheif`. The model `public/models/face_landmarker.task` is committed (download once from the MediaPipe model storage URL in the official docs). Workbox: `globPatterns: ['**/*.{js,mjs,css,html,svg,png,wasm,task}']`, `maximumFileSizeToCacheInBytes: 30 MB`; Vite `chunkSizeWarningLimit: 12000`.
- Vite `base`: `'/'` (served from the custom domain root).
- Manifest: `name`/`short_name` = `APP_NAME` ('KeeperShot', declared in both `src/config.ts` and `vite.config.ts`; change both to rename), `display: 'standalone'`, `theme_color #f97316`, `background_color #ffffff`, icons `public/icons/icon-192.png` and `icon-512.png` (`purpose: 'any maskable'`; generate from `icon.svg`).
- One ES-module pipeline worker. MediaPipe's and OpenCV's loaders call `importScripts`, which module workers lack, so `worker/lib/opencv.ts` shims it with a synchronous XHR + global eval.
- The OpenCV.js build lacks `estimateAffinePartial2D` and `seamlessClone`: the similarity fallback is a small JS RANSAC (`core/ransac.ts`) and Laplacian-pyramid blending is always used.
- Dev environment: `.devcontainer/devcontainer.json` (image `mcr.microsoft.com/devcontainers/javascript-node:22-bookworm`, forward ports 5173/4173, `postCreateCommand`: `npm ci --no-audit --no-fund && npx --no-install playwright install --with-deps --only-shell chromium`). Playwright (`playwright.config.ts`): `testDir tests/e2e`, `timeout 180_000`, `baseURL http://localhost:4173/`, `serviceWorkers: 'allow'`, one chromium project with args `--disable-dev-shm-usage --disable-gpu` (the container's /dev/shm is tiny; the 20 MP `family` fixture needs ~1 GB free), `webServer: npm run build && npx vite preview --port 4173 --strictPort`, `reuseExistingServer: true`, 300 s timeout.
- CI/CD: `.github/workflows/ci.yml` (Node 22, `npm ci`, `format:check`, `test`, `build`) on pull requests and pushes to `main`; pushes to `main` then publish `dist` to the `gh-pages` branch via `peaceiris/actions-gh-pages@v4`. Settings → Pages → Source = `gh-pages` branch.

## 2. Repository layout

```
.devcontainer/devcontainer.json   .github/workflows/{ci,deploy}.yml
public/models/face_landmarker.task   public/icons/{icon.svg,icon-192.png,icon-512.png}
index.html  vite.config.ts  playwright.config.ts  tsconfig.json  package.json
src/main.tsx            mount + service worker registration
src/app.tsx             screen router: upload | progress | review, plus #debug
src/config.ts           tunable thresholds and sizes (section 4)
src/types.ts            shared persisted data model + PipelineEvent (section 3)
src/storage.ts          IndexedDB keys + access (shared by worker and main thread)
src/index.css           Tailwind import
src/app/                store.ts (signals), actions.ts, workerClient.ts, pipelineLog.ts, save.ts, useStoredUrl.ts
src/ui/                 Upload, Progress, Review, FaceSheet, FaceMarkers, BaseStrip, Debug (.tsx)
src/worker/pipeline.worker.ts
src/worker/stages/      ingest.ts, detectPass.ts, alignPass.ts
src/worker/render/      renderer.ts, compositor.ts, blend.ts, frameCache.ts
src/worker/lib/         mediapipe.ts, opencv.ts, orb.ts, decode.ts, faceCrops.ts, jpegEncode.ts
src/core/               analyze, baseFrame, detectionFilters, detectionTiles, faceAlignment, feasibility, geometry,
                        grouping, hungarian, jpegQuality, landmarks, masks, picks, placement, pose, ransac,
                        scoring, session, stats (.ts)
tests/unit/*.test.ts + factories.ts   tests/e2e/smoke.spec.ts   tests/fixtures/<burst>/ (+ README.md)
docs/BUILD.md  docs/architecture.md  docs/future-work.md
```

Module roles:

- `app/store.ts`: signals for screen, session, progress feed, preview bitmap; derived `attentionPersonIds`, `swapCountByFrame`. `app/actions.ts`: everything that mutates state (start/resume/start over, picks, base, preview refresh, save). `app/workerClient.ts`: lazily starts/recycles the worker and `rendererFor`. `app/pipelineLog.ts`: `PipelineEvent` → feed line. `app/save.ts`: share sheet vs download. `app/useStoredUrl.ts`: hook giving an object URL for a stored blob.
- `core/geometry`: `Mat3` ops (compose/invert/apply), boxes, IoU, `fitSimilarity` (least-squares, returns matrix + `rms`), `convexHull`, `boxOf`, `scaleAboutCentroid`, `dist`. `core/stats`: `clamp`, `median`. `core/session`: lookups. `core/detectionFilters`: small-outlier and implausible-gaze rejection. `core/pose`: Euler yaw/pitch/roll from MediaPipe's 4×4 matrix. `core/jpegQuality`: JPEG quality from DQT tables. `core/hungarian`: min-cost assignment. `core/analyze`: grouping → scoring → base choice as one function.

## 3. Data model (`src/types.ts`, persisted in IndexedDB as `Session`)

```ts
type Mat3 = [number, number, number, number, number, number, number, number, number]; // row-major
type Pt = [number, number];
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Frame {
  id: string; // `f<index>` in capture-time order
  name: string; // original file name
  blobKey: string; // IndexedDB key of the original file
  width: number;
  height: number; // full-res, EXIF orientation applied
  toRef: Mat3; // this frame's full-res px → reference frame's full-res px (identity for the reference)
  alignInliers: number; // ORB inliers; 0 for the reference or when background alignment failed
  alignMethod?: 'orb' | 'faces'; // which transform became toRef
  matches?: [number, number, number, number][]; // sampled inliers [x, y, refX, refY] (debug view)
  exif: Record<string, unknown>; // JSON-safe EXIF of the original
  jpegQuality?: number; // estimated quality 0..1, reused for export
}
interface FaceScore {
  eyes: number;
  gaze: number;
  pose: number;
  smile: number;
  sharp: number;
  total: number; // all 0..1
}
interface Face {
  id: string; // `${frameId}:${index}`, index left to right
  frameId: string;
  landmarks: Pt[]; // 478, full-res frame px
  refLandmarks: Pt[]; // same, in reference-frame px (via toRef)
  box: Box; // landmark bbox, full-res px
  refBox: Box;
  blend: Record<string, number>; // MediaPipe blendshapes by name
  pose: { yaw: number; pitch: number; roll: number }; // degrees
  sharpness: number; // raw Laplacian variance of the face crop
  score: FaceScore;
  thumbKey: string; // IndexedDB key of the face thumbnail
}
interface Person {
  id: string; // `p<n>`, numbered left to right
  faces: Record<string, string>; // frameId → faceId (≤ 1 face per frame)
}
type SwapMode = 'eyes' | 'face';
type PickMode = SwapMode | 'base' | 'skip'; // 'skip' pastes nothing (faceId '')
interface FacePick {
  personId: string;
  faceId: string;
  mode: PickMode;
  auto: boolean; // false once the user confirms a choice
}
interface Session {
  frames: Frame[];
  faces: Record<string, Face>;
  people: Person[];
  refFrameId: string; // middle frame by time
  baseFrameId: string;
  picks: Record<string, FacePick>; // personId → pick
}
type PipelineEvent =
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
```

IndexedDB keys (`src/storage.ts`, idb-keyval default store): `session` (the `Session` JSON), `frame:<frameId>` (original blob), `fthumb:<frameId>` (small whole-frame JPEG for the base strip), `thumb:<faceId>` (small face-crop JPEG). Exports: `saveSession`, `loadSession`, `putBlob`, `getBlob`, `clearAll`, `frameBlobKey`, `frameThumbKey`, `faceThumbKey`.

`src/core/landmarks.ts` (every MediaPipe 478-mesh index set used):

```ts
export const ALIGN_POINTS = [33, 133, 362, 263, 1, 61, 291]; // eye corners, nose tip, mouth corners
export const RIGID_POINTS = [33, 133, 362, 263, 6, 168, 10, 338, 297, 332, 284, 251, 21, 54, 103, 67, 109, 162, 389]; // rigid across expressions
export const EYE_CORNERS = { right: { outer: 33, inner: 133 }, left: { outer: 263, inner: 362 } }; // subject's right eye is image-left
export const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
  172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
];
export const BROWS = [70, 63, 105, 66, 107, 336, 296, 334, 293, 300];
export const EYE_REGIONS = [
  {
    contour: [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
    brow: [70, 63, 105, 66, 107, 55, 65, 52, 53, 46],
    lowerLid: [33, 7, 163, 144, 145, 153, 154, 155, 133],
  },
  {
    contour: [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466],
    brow: [300, 293, 334, 296, 336, 285, 295, 282, 283, 276],
    lowerLid: [263, 249, 390, 373, 374, 380, 381, 382, 362],
  },
];
export const LIPS = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185];
```

## 4. Tunables (`src/config.ts`, current values)

Reproduce exactly; comments carry the intent. Thresholds named elsewhere in this doc refer to these constants.

```ts
export const APP_NAME = 'KeeperShot';

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
// Progress screen "looking away" counter (quick per-face flags before people are grouped)
export const AWAY_GAZE = 0.5;
export const AWAY_POSE = 0.4;

// Swap
export const EYES_MAX_DPOSE = 6;
export const EYES_MAX_RESIDUAL = 0.04;
export const FACE_MAX_DPOSE = 15;
export const FACE_MAX_RESIDUAL = 0.08;
export const SWAP_GAIN_MIN = 0.02; // swap whenever a feasible face scores clearly better
export const WIN_EPSILON = 0.02; // faces this close to a person's best count as "best" for base choice
export const BASE_SUM_TOL = 0.01; // per person: base frames whose achievable summed score is this close count as equal
export const SMILE_SIMILAR = 0.1;

// Composite
export const ROI_SCALE = 1.6;
export const FACE_FOREHEAD_RAISE = 0.15;
export const FACE_JAW_ERODE = 0.03;
export const FACE_FEATHER = 0.08;
export const EYES_DILATE = 0.25;
export const EYES_FEATHER = 0.3;
export const PYRAMID_LEVELS = 5;
export const PREVIEW_LONG_EDGE = 1600;

// Progress weights (percent)
export const PROGRESS = { decode: 10, detect: 40, align: 30, group: 5, preview: 15 };
export const AUTO_ADVANCE_MS = 1000;
```

## 5. Analysis pipeline (worker, sequential per frame to bound memory)

Entry: `pipeline.worker.ts` exposes `analyzeBurst(files, emit)` through Comlink (plus the render API, section 6). Stages: `stages/ingest` → `stages/detectPass` → `stages/alignPass` → `core/faceAlignment.misalignedFrames` → `core/analyze`. The worker writes originals, thumbnails and the `Session` to IndexedDB as it goes (`storage.ts`) so a reload can Resume straight into Review. The worker is **terminated after analysis** (WASM heaps never shrink); a fresh worker serves rendering.

**Memory rule:** never hold more than one full-resolution bitmap at a time in the analysis passes; `close()` bitmaps and free every OpenCV Mat (`withMats`/`withMatsSync` helpers in `lib/opencv.ts`), releasing large ones as soon as they're dead (`Tracker.release`): the WASM heap high-water mark is what counts.

### 5.1 Ingest (`stages/ingest`)

- Accept `image/*`, `MIN_FILES`–`MAX_FILES` files. HEIC that fails `createImageBitmap` is decoded with lazy `libheif-js` (`lib/decode.ts`).
- Read EXIF with `exifr` one file at a time; estimate JPEG quality from the DQT tables (`core/jpegQuality.ts`, IJG-style, clamped `JPEG_QUALITY_MIN..MAX`, fallback `JPEG_QUALITY_FALLBACK`).
- Sort frames by `DateTimeOriginal` (+ `SubSecTimeOriginal`); frames without it keep file order after the dated ones. Create `Frame`s with ids `f0…` in that order.
- Upload thumbnails are decoded one at a time at `THUMB_PX`.
- Decode with `createImageBitmap(blob, { imageOrientation: 'from-image' })`. Source frames are decoded whole (never cropped) because `createImageBitmap` crop + EXIF orientation behaves inconsistently across browsers.

### 5.2 Detect (`stages/detectPass`, one full-res bitmap at a time)

Per frame: store the original blob; scan; verify; store thumbnails; keep a grayscale align-size copy with face boxes masked. The face model is closed afterwards so OpenCV loads under less memory pressure.

- FaceLandmarker config: `runningMode: 'IMAGE'`, `numFaces: MAX_FACES`, blendshapes and facial transformation matrixes on. CPU (XNNPACK) delegate (`DETECT_DELEGATE`).
- MediaPipe's detector shrinks its input to ~128 px and only finds faces covering ~1/6 of it. So every frame is scanned whole plus with overlapping tiles at several scales (`core/detectionTiles.ts`): `tileSizes` goes from `TILE_COARSEST_FRAC × long edge` down by `TILE_STEP` to a finest tile of `max(MIN_FACE_PX, long × MIN_FACE_FRAC) × TILE_PER_FACE`; `tilePlan` lays tiles with `TILE_OVERLAP`, keeping tiles inside the frame. After the first frame, scales finer than `TILE_REGION_BELOW × long edge` scan only `searchRegion` (bounding box of the previous frame's faces grown by `TILE_REGION_MARGIN × long edge`, only if ≥ `TILE_REGION_MIN_FACES` faces).
- Scan at `SCAN_CONFIDENCE` in working resolution (`WORK_LONG_EDGE`). Faces cut by an interior tile edge are discarded (an overlapping tile sees them whole); duplicates merge on IoU (`TILE_MERGE_IOU`) or centre-in-box.
- **Refine**: every candidate is re-run through the landmarker on a full-res crop (`REFINE_CONTEXT` × face size, resized to `REFINE_PX`, upsampled if below `REFINE_MIN_PX`) requiring `MIN_FACE_CONFIDENCE`, presence ≥ `REFINE_PRESENCE` and IoU ≥ `REFINE_MIN_IOU` with the candidate. This rejects hands/props and gives landmarks, blendshapes, sharpness (variance of Laplacian on the grayscale crop resized to `SHARPNESS_CROP_PX` wide) and thumbnails from full-res pixels. Landmarks are in full-res frame px; `pose` comes from the transformation matrix (`core/pose.ts`).
- `core/detectionFilters`: reject candidates whose gaze blendshapes saturate in several directions (`GAZE_SATURATED`, `GAZE_SATURATED_MAX`) as non-faces; in frames with ≥ `MIN_REL_FACE_COUNT` faces, drop faces smaller than `MIN_REL_FACE` × the frame's median.
- One `FaceLandmarker` instance switches options between scanning and refining (a second instance cost ~100 MB of WASM heap).
- Faces get ids `${frameId}:${i}` ordered left to right; a 160 px (`THUMB_PX`, `THUMB_QUALITY`) JPEG face thumbnail goes to `thumb:<faceId>` and a frame thumbnail to `fthumb:<frameId>`. `quickFlags` (blink/away/funny, `core/scoring`) feed the progress `thumb` events.
- Printed faces (e.g. a photo cutout) are detected as people, by design.

### 5.3 Align (`stages/alignPass`, `lib/orb`)

- The reference frame is the middle frame by time.
- Background alignment at `ALIGN_LONG_EDGE`: ORB (`ORB_FEATURES`) on grayscale with each frame's face boxes masked out (enlarged `ALIGN_MASK_WIDE` wide × `ALIGN_MASK_TALL` tall; `ALIGN_MASK_*`), BFMatcher Hamming kNN k=2 + Lowe ratio (`LOWE_RATIO`), RANSAC homography (`RANSAC_THRESHOLD` px) validated for inliers ≥ `ALIGN_MIN_INLIERS`, perspective terms ≤ `ALIGN_PERSPECTIVE_MAX` and scale within `ALIGN_SCALE_MIN..MAX`; else a RANSAC similarity (`core/ransac.ts`); else identity (log a `warn` event). Scale back to full res: `H_full = S⁻¹·H·S`. Sample up to `DEBUG_MAX_MATCHES` inlier matches into `Frame.matches`.
- Face alignment (`core/faceAlignment.ts`): face-pair seeds (`FACE_ALIGN_SEED_TOL`, top `FACE_ALIGN_TOP`), then iterative similarity fits (`FACE_ALIGN_REFINE_TOLS`) on `ALIGN_POINTS` landmarks of matched faces (needs ≥ `FACE_ALIGN_MIN_FACES`; a face "lines up" within `FACE_ALIGN_TOL` face widths). `chooseFrameTransform`: whichever transform (background vs faces) lines up more faces with the reference becomes `toRef` (`Frame.alignMethod`). Needed when the background aligns differently from the group (parallax, grass). A similarity (not affine/homography) keeps single-row groups stable.
- Map each face's landmarks and box into reference coords → `refLandmarks`, `refBox`.
- Leave-out: frames where fewer than `FRAME_MIN_ALIGNED` of the reference frame's faces line up are dropped from the session (warning logged), as long as `FRAME_MIN_KEPT` frames remain.

### 5.4 Group into people (`core/grouping.ts`)

- Seed clusters with the frame that has the most faces. For each other frame, match faces to clusters by Hungarian assignment (`core/hungarian`) on a cost mixing `1 − IoU(refBox, cluster mean box)` and centre distance (`GROUP_CENTER_WEIGHT`); accept a match on `GROUP_MIN_IOU` or within `GROUP_MAX_DIST` face widths; otherwise start a new cluster. One face per frame per person.
- Fragments that never share a frame merge when their distance is within `GROUP_MERGE_BASE + GROUP_MERGE_PER_FRAME × frame gap` (people who moved).
- Clusters seen in fewer than `GROUP_MIN_FRAME_FRACTION` of frames are dropped (passers-by), as are people whose median sharpness is below `MIN_REL_SHARPNESS` × the median person's (out-of-focus background mistaken for a face). Faces not assigned to a kept person are removed from the session.
- People are ordered left to right by mean ref x; ids `p1…pN`.
- Known limitation: kids who move relative to the group can still split into separate "people" (position-only grouping; an identity-embedding model would fix it).

### 5.5 Score (`core/scoring.ts`)

Blendshape names are MediaPipe's.

- `eyes = 1 − max(eyeBlinkLeft, eyeBlinkRight)`.
- `gaze = 1 − clamp(mean over both eyes of max(eyeLookIn/Out/Up/Down), 0, 1)`.
- `pose = 1 − clamp((|yaw| + |pitch|) / POSE_RANGE_DEG, 0, 1)`.
- `smile = clamp(mean(mouthSmileLeft, mouthSmileRight) − funnyPenalty, 0, 1)`; `funnyPenalty = 0.5·max(jawOpen − JAW_OPEN_FREE, 0) + tongueOut + max(max(cheekPuff, mouthPucker) − FUNNY_FREE, 0)`.
- `sharp` = sharpness min-max normalised within the person's cluster (1 for all if the range is ~0).
- `total = Σ SCORE_WEIGHTS × components`, multiplied by `BLINK_PENALTY` on a blink. A blink is `eyes < BLINK_THRESHOLD` or `eyes < BLINK_REL ×` the person's most-open eyes score in the burst (baseline openness varies by person and smile).
- Progress counters ("looking away" = gaze < `AWAY_GAZE` or pose < `AWAY_POSE`) use `quickFlags` before grouping, with the absolute blink threshold only.

### 5.6 Swap feasibility (`core/feasibility.ts`)

For a source face S replacing the base-frame face B of the same person (all in ref coords):

- `dpose = max(|Δyaw|, |Δpitch|, |Δroll|)`; `residual = RMS of fitSimilarity(S.RIGID_POINTS → B.RIGID_POINTS) / inter-ocular distance of B`.
- Eyes ok if `dpose ≤ EYES_MAX_DPOSE` and `residual ≤ EYES_MAX_RESIDUAL`; face ok if `≤ FACE_MAX_DPOSE` and `≤ FACE_MAX_RESIDUAL`. Otherwise not ok with reason "head turned too much" (dpose) or "face shape differs too much" (residual).
- No base face: eyes never ok ("no base face"); face ok only if S's own |yaw|,|pitch|,|roll| ≤ `FACE_MAX_DPOSE`.
- `autoMode`: `eyes` when eyes is feasible, the smiles are similar (`SMILE_SIMILAR`) and the base face has no funny-face penalty; else `face` if feasible; else none.

### 5.7 Picks and base frame (`core/picks.ts`, `core/baseFrame.ts`)

- `choosePick(person, baseFrameId)`: if the person has no face in the base frame → `skip` (paste nothing: they're usually still there but turned away; pasting created doubled "ghost" faces). Otherwise the best-scoring face with an auto mode is swapped in only if it beats the base face by more than `SWAP_GAIN_MIN`; else `base`.
- `chooseBase`: evaluate each frame as base (each person at their best feasible face). The highest summed final score wins; sums within `BASE_SUM_TOL × people count` count as equal and then prefer fewer swaps, more of each person's best faces already in place (faces within `WIN_EPSILON` of the person's best), higher sum, the reference frame, then more alignment inliers.
- `rebase(newBase, …, oldPicks)`: recompute automatic picks for a new base, keeping manual picks that are still feasible (manual `base`/`skip` handled accordingly).
- `needsAttention` (amber): final face `score.total < LOW_CONFIDENCE_TOTAL`; or a `skip` person seen in at least half the frames (short-lived clusters are usually grouping fragments). `isSwap` = mode `eyes` or `face`.
- Changing the base in the UI re-runs this (instant, pure). `core/analyze` returns people, scored faces, base frame id and picks.

## 6. Rendering and export (`src/worker/render/`)

- **Session in the worker**: `setSession` loads the analysed session once per worker (`app/workerClient.rendererFor` re-sends it only when `session.faces` changes identity, i.e. after a new analysis or Resume). Preview, before/after and export calls send only `baseFrameId` + picks (not every face's landmarks on each tap; this dropped Review RSS 14–137 MB). Render calls are serialised in the worker.
- **Placement** (`core/placement.ts`): source→base transform `T = inv(base.toRef) · src.toRef`, refined by a similarity fit on `RIGID_POINTS` (the local fit wins; the global `T` only seeds the ROI). ROI = face box × `ROI_SCALE` in base coords. `planIncrementalUpdate` decides which ROIs to restore from the base copy and which swaps to redo (changed ones plus anything overlapping, transitively).
- **Masks** (`core/masks.ts`): constants `FOREHEAD_EXTRA 0.3`, `JAW_START 0.25`, `CHEEK_DROP 0.5`, `SKIN_SHRINK 0.8`, `SKIN_EXCLUDE_EYES 1.25`, `SKIN_EXCLUDE_LIPS 1.3`.
  - `face`: hull of `FACE_OVAL` landmarks; points above the brow box are lifted by `(cy − y) × FACE_FOREHEAD_RAISE × FOREHEAD_EXTRA`; oval points below `cy + h × JAW_START` are pulled toward the face centre by `FACE_JAW_ERODE × face width` (avoids chin/neck seams); hull also includes `BROWS`. Feather = `face width × FACE_FEATHER`.
  - `eyes`: one polygon per eye from `contour` + `brow` + `lowerLid` pushed down by `CHEEK_DROP × eye width`, hulled and scaled about its centroid by `1 + 2·EYES_DILATE·eyeW/hullW`. Feather = `eye width × EYES_FEATHER`.
  - `skinPolygons` (colour statistics): face mask shrunk to `SKIN_SHRINK`, minus brows+eyes grown `SKIN_EXCLUDE_EYES` and lips grown `SKIN_EXCLUDE_LIPS`.
- **Swap** (`compositor.applySwap`): warp only the source region the ROI needs with `cv.warpAffine` (Lanczos), rasterise mask and skin polygons, then `blend.blendPatch`: feather the mask, Lab mean/std colour transfer onto the patch, Laplacian-pyramid blend (`PYRAMID_LEVELS`, mask Gaussian pyramid), write the ROI back. Face swaps measure colour statistics over the skin interior (only where the source covers the ROI), falling back to a ring inside the mask edge if too small; eye swaps use the ring.
- **Preview**: `Renderer.renderPreview` keeps one `Compositor` per (base frame, scale) at `PREVIEW_LONG_EDGE`; a pick change restores only the affected ROIs from the base copy and re-blends them plus overlapping picks, in stable person order. Source frames come from a small LRU `FrameCache`, decoded straight to the target size with `createImageBitmap` resize. `renderFrame` returns an untouched frame (before/after).
- **Memory**: blending releases every OpenCV Mat as soon as it is dead (`Tracker.release`) and builds, blends and frees the Laplacian pyramid level by level, so ~one level's images are alive at a time (pixel-identical output; on a 13 MP close-up export peak went 1016 → 666 MB renderer RSS). Export frees the preview caches first. Needed because 20 MP bursts crashed the renderer in ~2 GB containers.
- **Export** (`renderer.exportJpeg`, `lib/jpegEncode`): full-res one-shot compositor at `scale = 1` → `OffscreenCanvas.convertToBlob({ type: 'image/jpeg', quality: base.jpegQuality })`. Output dimensions equal the base frame's. EXIF: allow-listed tags (Make, Model, LensModel, DateTimeOriginal, OffsetTimeOriginal, SubSec*, FNumber, ExposureTime, ISO, FocalLength, FocalLengthIn35mmFilm, GPS*, ColorSpace) are copied from the base JPEG via piexifjs, falling back to the parsed EXIF (Make/Model/DateTimeOriginal) for non-JPEG bases such as HEIC; Orientation reset to 1, PixelXDimension/PixelYDimension updated, Software = `APP_NAME`. Filename `<base name>-keepershot.jpg`.
- Save (`app/save.ts`): use `navigator.canShare({ files })` + `navigator.share` only on phones/tablets (offers Photos/Files); on desktop download via `<a download>`. A separate ⬇ button always downloads.
- Known limitation: a hand or prop covering part of the source face is pasted along with it.

## 7. UI

Mobile-first, one column, bright and minimal; orange accent (`#f97316`).

- **Upload**: big drop/tap zone ("Pick 2–20 shots of the same group"), thumbnails, **Start**. If a stored session exists: **Resume** / **Start over** (`clearAll`). Call `navigator.storage.persist()` on first Start.
- **Progress**: event-driven feed (`app/pipelineLog.ts`) plus a growing grid of face thumbnails grouped into person rows, live counters (faces found, people, blinks caught, looking away, funny faces), red dot on blinks. Determinate bar using `PROGRESS` weights (decode 10, detect 40, align 30, group/score/select 5, preview 15). Final line "Best base: photo N — needs K fixes", then auto-advance to Review after `AUTO_ADVANCE_MS`.
- **Review**: composite fills the screen with `@panzoom/panzoom` (wheel/pinch/+−; once zoomed, drag, with the pan clamped by hand in `panzoomchange` so the photo always covers its frame — panzoom's own `contain` mis-positioned the centred stage). Each face gets a coloured rectangle (`FaceMarkers`): white = base, blue = eyes swapped, purple = face swapped, amber = check, dashed = skipped, with a small status chip; ◻︎ toggles markers. "Next to check" cycles amber faces. Press-and-hold shows the untouched base frame. **Save** exports.
- **FaceSheet** (tap a face): bottom sheet with a carousel of that person's candidates (one per frame) with chips for eyes/gaze/smile/total; an Eyes/Face toggle; live preview behind the sheet; Confirm/Cancel (confirming sets `auto: false`). Infeasible candidates are not disabled: tapping one forces a face swap ("tap to force"), while auto-selection still respects feasibility.
- **BaseStrip**: filmstrip of frame thumbnails with the swap count under each; tap to change base (`rebase`).
- **Debug** (`/#debug`): landmarks, boxes + person IDs, swap masks, sampled ORB inlier matches, alignment method/inliers/`toRef`, score table.

## 8. Persistence

Save `session` after each pipeline stage and after every pick change. On load, if `session` exists offer Resume and go straight to Review (re-render from stored data; no re-detection). Start over clears all keys.

## 9. Tests

- Unit (Vitest) for `core/`: faceAlignment, geometry, grouping, hungarian, jpegQuality, placement, pose, ransac, scoring, selection (picks/base/feasibility). `tests/unit/factories.ts` builds synthetic faces/frames.
- E2E (`tests/e2e/smoke.spec.ts`): app loads and the service worker registers; upload works; for each `tests/fixtures/<burst>/` (images gitignored, `expected.json` `{ "people": N }` tracked) run the full pipeline and check people count, a rendered preview and an exported JPEG with the base's dimensions and EXIF `DateTimeOriginal`. Skips cleanly when there are no fixtures. `tests/fixtures/README.md` explains the layout.
- Fixture status (people found vs `expected.json`, 2026-11-18): big-family 47/52, family 14/14, kids 23/19, portrait 2/1. Over-splitting of moving subjects, cutouts and a few undetected faces explain the gaps; compare against the previous run rather than expecting green. Update this line when counts change.
- A behaviour-preserving refactor must leave output identical: same people, base frame and picks per fixture and a byte-identical exported JPEG (rendering is deterministic).

## 10. Out of scope

Whole-head or whole-body swaps; Live Photo frames; manual "add a missed face"; identity embeddings; generative seam repair; accounts, sharing links, any backend. See [future-work.md](future-work.md).
