> **Historical document.** This is the original build spec the app was generated from. Many details have since changed (thresholds, detection, base selection, missing-person handling, file layout). The current truth is [AGENTS.md](../../AGENTS.md), [architecture.md](../architecture.md), [decisions.md](../decisions.md) and `src/config.ts`.

# BUILD.md — KeeperShot

A client-only web app / PWA that takes several near-identical group photos, finds every face, groups faces by person, auto-picks the best face per person, lets the user review/change picks, and composites one final photo where everyone looks good.

Runs entirely in the browser. No backend. Deployed to GitHub Pages.

The app name lives in one constant (`APP_NAME` in `src/config.ts`) and in `vite.config.ts` (PWA manifest). Change both to rename.

---

## 0. Ground rules for the coding agent

- **Step 0 (devcontainer) comes first.** If you are NOT running inside the devcontainer, do Step 0 only, then stop and tell the user:

  > "Devcontainer created. Reopen this folder in the container (VS Code: _Dev Containers: Reopen in Container_), then ask me to continue the build from Milestone 1."

  Detect the container with `REMOTE_CONTAINERS=true`, `CODESPACES=true` or the existence of `/.dockerenv`. Inside the container, skip Step 0 and continue.

- Work milestone by milestone. Commit after each milestone with a clear message.
- Do not ask the user questions after Step 0. Make reasonable choices and record them in `DECISIONS.md` (one line each).
- Keep code small. Prefer pure functions in `src/core/` with unit tests. UI stays thin.
- All tunable numbers live in `src/config.ts`. No magic numbers elsewhere.
- No server code. No analytics. No external network calls at runtime except loading the app's own static assets.

---

## Step 0 — Devcontainer

Create `.devcontainer/devcontainer.json`:

```json
{
  "name": "keepershot",
  "image": "mcr.microsoft.com/devcontainers/typescript-node:22",
  "forwardPorts": [5173, 4173],
  "portsAttributes": { "5173": { "label": "vite dev" }, "4173": { "label": "vite preview" } },
  "postCreateCommand": "npm ci --include=dev && npx --no-install playwright install --with-deps chromium webkit",
  "customizations": {
    "vscode": {
      "extensions": [
        "dbaeumer.vscode-eslint",
        "esbenp.prettier-vscode",
        "bradlc.vscode-tailwindcss",
        "vitest.explorer",
        "ms-playwright.playwright"
      ]
    }
  }
}
```

Add a minimal `package.json` (name, `"private": true`, `"type": "module"`) with an exact `playwright` devDependency. Generate and commit `package-lock.json` along with the manifest so `npm ci` works on a fresh checkout. The post-create command includes dev dependencies and uses only the installed Playwright CLI, without an interactive package download or a fallback that masks install failures. Commit. **Stop and prompt the user to reopen in the container.**

---

## 1. Stack (chosen for fewest lines and LLM maintainability)

| Concern                  | Choice                                                                                       | Why                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Build                    | Vite + TypeScript (strict)                                                                   | Zero-config, fast                                                             |
| UI                       | Preact + `@preact/signals`                                                                   | React API (best LLM familiarity), ~4KB, signals remove most state boilerplate |
| Styling                  | Tailwind CSS v4 (`@tailwindcss/vite`)                                                        | No CSS files to maintain                                                      |
| PWA                      | `vite-plugin-pwa` (generateSW, autoUpdate)                                                   | Manifest + service worker in ~15 lines of config                              |
| Worker RPC               | `comlink`                                                                                    | Call worker functions like async functions                                    |
| Face landmarks           | `@mediapipe/tasks-vision` FaceLandmarker (478 landmarks, blendshapes, transformation matrix) | Best in-browser quality, Apache-2.0                                           |
| CV ops                   | `@techstark/opencv-js` (lazy-loaded in worker)                                               | ORB, homography, warps, pyramids, Laplacian                                   |
| EXIF read                | `exifr`                                                                                      | Reads JPEG + HEIC                                                             |
| EXIF write               | `piexifjs`                                                                                   | Writes EXIF into the output JPEG                                              |
| HEIC decode (non-Safari) | `libheif-js` (lazy, only when a HEIC fails to decode natively)                               | Desktop Chrome/Firefox                                                        |
| Persistence              | `idb-keyval`                                                                                 | Resume session after iOS kills the tab                                        |
| Pan/zoom                 | `@panzoom/panzoom`                                                                           | Large groups need zoom on the composite                                       |
| Tests                    | Vitest (unit), Playwright (e2e smoke)                                                        |                                                                               |

**Constraints:**

- GitHub Pages cannot set COOP/COEP headers, so `SharedArrayBuffer` is unavailable. Use only single-threaded WASM builds (the defaults for both MediaPipe and OpenCV.js). Never require cross-origin isolation.
- Self-host all models and WASM: copy them into `public/` (MediaPipe wasm via `vite-plugin-static-copy` from `node_modules/@mediapipe/tasks-vision/wasm`). Commit `public/models/face_landmarker.task` (download it once from the MediaPipe model storage URL in the official docs). The service worker precaches everything so the app works offline after the first load.
- Set Vite `base` from the repo name in CI: `base: process.env.GITHUB_REPOSITORY ? '/' + process.env.GITHUB_REPOSITORY.split('/')[1] + '/' : '/'`.

---

## 2. Repo layout

```
.devcontainer/devcontainer.json
.github/workflows/deploy.yml
public/models/face_landmarker.task
public/icons/…                      # PWA icons (generate simple SVG → PNG 192/512)
src/
  main.tsx                          # mount
  app.tsx                           # screen router: upload | progress | review
  config.ts                         # ALL thresholds/weights/sizes
  types.ts                          # shared types (below)
  state.ts                          # signals: session, progress events, selections
  db.ts                             # idb-keyval persistence
  ui/
    Upload.tsx
    Progress.tsx
    Review.tsx                      # composite + face badges + base strip + export
    FaceSheet.tsx                   # bottom sheet with candidates for one person
    BaseStrip.tsx                   # filmstrip to change base frame
    Debug.tsx                       # /#debug overlays (landmarks, matches, masks)
  worker/
    pipeline.worker.ts              # Comlink-exposed API, sequential processing
    cv.ts                           # lazy OpenCV loader + Mat helpers + cleanup
    decode.ts                       # File → ImageBitmap (orientation baked), HEIC fallback
    detect.ts                       # MediaPipe FaceLandmarker wrapper
    align.ts                        # ORB + RANSAC homography per frame → reference
    composite.ts                    # warp patch, build mask, color-match, blend
    encode.ts                       # canvas → JPEG blob + EXIF
  core/                             # PURE functions, no DOM, fully unit-tested
    geometry.ts                     # 3x3 matrices, apply/invert/compose, similarity fit
    group.ts                        # cluster faces into people
    score.ts                        # per-face quality score
    pose.ts                         # yaw/pitch/roll from transformation matrix
    select.ts                       # base-frame choice, auto-picks, swap mode
    jpegQuality.ts                  # estimate JPEG quality from DQT tables
tests/
  unit/*.test.ts
  e2e/smoke.spec.ts
  fixtures/                         # user-provided bursts (gitignored except README)
DECISIONS.md
```

---

## 3. Data model (`src/types.ts`)

```ts
type Mat3 = [number, number, number, number, number, number, number, number, number];

interface Frame {
  id: string; // index-based, e.g. "f0"
  name: string;
  blobKey: string; // original file stored in IndexedDB
  width: number;
  height: number; // full-res, orientation applied
  toRef: Mat3; // full-res frame coords → reference-frame coords
  alignInliers: number;
  exif: Record<string, unknown>;
  jpegQuality?: number;
}

interface Face {
  id: string; // `${frameId}:${i}`
  frameId: string;
  landmarks: [number, number][]; // full-res frame coords (478)
  refLandmarks: [number, number][]; // in reference coords (via toRef)
  box: { x: number; y: number; w: number; h: number }; // frame coords
  refBox: { x: number; y: number; w: number; h: number }; // ref coords
  blend: Record<string, number>; // MediaPipe blendshapes by name
  pose: { yaw: number; pitch: number; roll: number }; // degrees
  sharpness: number; // raw Laplacian variance on face crop
  score: FaceScore;
  thumbKey: string; // small JPEG crop for the UI
}

interface FaceScore {
  eyes: number;
  gaze: number;
  pose: number;
  smile: number;
  sharp: number;
  total: number;
}

interface Person {
  id: string;
  faces: Record<string /*frameId*/, string /*faceId*/>;
}

type SwapMode = 'eyes' | 'face';
interface Pick {
  personId: string;
  faceId: string;
  mode: SwapMode | 'base';
  auto: boolean;
}

interface Session {
  frames: Frame[];
  faces: Record<string, Face>;
  people: Person[];
  refFrameId: string;
  baseFrameId: string;
  picks: Record<string, Pick>;
}
```

---

## 4. Pipeline (worker, strictly sequential per frame to bound memory)

### 4.1 Ingest and decode

- Accept `image/*` multi-select (2–20 files). iOS `<input type=file>` delivers JPEG. If `createImageBitmap` fails on a HEIC, lazy-load `libheif-js`.
- Store original `File` blobs in IndexedDB immediately (resume support).
- Read EXIF with `exifr` (keep the full object). Estimate JPEG quality from the DQT tables (`core/jpegQuality.ts`, IJG-style estimate, clamp 0.85–0.97, fallback 0.92).
- Sort frames by `DateTimeOriginal` (+ `SubSecTimeOriginal`), falling back to file order.
- Decode with `createImageBitmap(blob, { imageOrientation: 'from-image' })`.
- **Memory rule:** never hold more than one full-res bitmap plus one working-res copy at a time. Working resolution is `WORK_LONG_EDGE = 2048`. Close bitmaps (`.close()`) and `delete()` every OpenCV Mat in `finally` blocks (helper `using`-style wrapper in `cv.ts`).

### 4.2 Detect (per frame, at working resolution)

- FaceLandmarker: `runningMode: 'IMAGE'`, `numFaces: 50`, `outputFaceBlendshapes: true`, `outputFacialTransformationMatrixes: true`, `minFaceDetectionConfidence: 0.5`. Try `delegate: 'GPU'`, catch and fall back to `'CPU'`.
- Faces narrower than `MIN_FACE_PX = 40` (working res) are ignored.
- MediaPipe's detector is tuned for near faces. If a frame yields 0 faces while the image is large, retry on 2×2 overlapping tiles (25% overlap) and merge duplicates by IoU > 0.5. Accept misses beyond that (v1).
- Scale landmarks to full-res coords. Compute `pose` from the transformation matrix (`core/pose.ts`). Compute `sharpness` = variance of the Laplacian on the grayscale face crop resized to 128px wide.
- Save a 160px face thumbnail (JPEG 0.8) to IndexedDB.

### 4.3 Align (per frame, at 1024px long edge)

- Reference frame = middle frame by time.
- ORB with 5000 features on grayscale. **Mask out the detected face boxes, enlarged 1.5× wide and 3× tall downward** (people move; the background doesn't).
- BFMatcher Hamming with kNN k=2, Lowe ratio 0.75, then `findHomography` RANSAC with 3px reprojection threshold.
- Validate: inliers ≥ `ALIGN_MIN_INLIERS = 40` and the homography is near-affine (|h31|,|h32| small, scale within 0.8–1.25). Otherwise fall back to `estimateAffinePartial2D` on the same matches; if that fails too, use identity and log a warning event.
- Scale H to full res: `H_full = S⁻¹·H·S`. Store as `toRef`.
- Map each face's landmarks and box into ref coords → `refLandmarks`, `refBox`.

### 4.4 Group into people (`core/group.ts`, pure)

- Seed clusters with the faces of the frame that has the most faces.
- For each other frame, match faces to clusters by **Hungarian assignment** on the cost `1 − IoU(refBox, clusterMeanBox)` plus normalized center distance. Accept a match if IoU ≥ `GROUP_MIN_IOU = 0.3`; otherwise start a new cluster.
- One face per frame per person (guaranteed by the assignment).
- Drop clusters present in fewer than `max(1, ceil(frames × 0.25))` frames (passers-by, false positives).
- Order people left-to-right by mean ref x (stable IDs `p1…pN`).
- Hook for v1.1 (not built in v1): an optional identity-embedding term in the cost if position-only grouping fails on real bursts.

### 4.5 Score (`core/score.ts`, pure)

Blendshape names follow MediaPipe's.

- `eyes = 1 − max(eyeBlinkLeft, eyeBlinkRight)`. Hard penalty: if `eyes < 0.5`, total × 0.3.
- `gaze = 1 − clamp(mean of max(eyeLookIn/Out/Up/Down) per eye, 0, 1)`.
- `pose = 1 − clamp((|yaw| + |pitch|) / 40°, 0, 1)`.
- `smile = mean(mouthSmileLeft, mouthSmileRight)`. Penalize funny faces: subtract `0.5 × max(jawOpen − 0.5, 0)`, `tongueOut`, and `max(cheekPuff, mouthPucker) − 0.5` if positive.
- `sharp` = sharpness normalized min-max **within the person's cluster**.
- `total = 0.40·eyes + 0.20·gaze + 0.15·pose + 0.15·smile + 0.10·sharp` (weights in `config.ts`).

### 4.6 Swap feasibility and mode (`core/select.ts`, pure)

For a candidate source face S replacing base face B of the same person:

- `Δpose = max(|yawS−yawB|, |pitchS−pitchB|, |rollS−rollB|)`.
- Fit a similarity transform S→B on rigid landmarks (eye corners, nose bridge, upper face oval). `residual` = RMS error / inter-ocular distance.
- **Eyes** allowed if `Δpose ≤ EYES_MAX_DPOSE = 6°` and `residual ≤ 0.04`.
- **Face** allowed if `Δpose ≤ FACE_MAX_DPOSE = 15°` and `residual ≤ 0.08`.
- Otherwise the candidate is **disabled**, with a reason ("head turned too much").
- **Auto mode:** if B's problem is only eyes/gaze (B.smile within 0.1 of S.smile and no funny-face penalty on B) and eyes is allowed → `eyes`; else `face` if allowed; else keep the base face.
- If a person has no face in the base frame (missed detection), only `face` is possible, placed using the source face mapped through the transforms. Allowed if the source pose is within `FACE_MAX_DPOSE` of frontal.

### 4.7 Base frame and auto-picks (`core/select.ts`, pure)

- For each candidate base frame f: for each person, `best` = the highest-scoring feasible candidate (base face included). A swap is needed if `best.total − score(f's face) > SWAP_GAIN_MIN = 0.12`.
- Base = the frame with the fewest needed swaps. Tie-break by highest sum of final scores, then by most alignment inliers.
- Changing base in the UI re-runs this function for the chosen frame (instant, pure).

### 4.8 Composite (`worker/composite.ts`)

Base canvas = full-res base frame. For each pick with mode ≠ base:

1. Transform source → base: `T = inv(base.toRef) · src.toRef`, refined by the similarity fit on rigid landmarks (the local fit wins; the global T only seeds the ROI).
2. Cut a ROI = the face box × 1.6 in base coords. Decode only the needed source region (`createImageBitmap(blob, sx, sy, sw, sh)` on the source with margin), warp it into the ROI with `warpAffine` (Lanczos).
3. Mask:
   - `face`: convex hull of face-oval landmarks, raised to include the eyebrows and about 15% of the forehead. Erode the jawline by 3% of face width (avoid chin/neck seams). Feather = 8% of face width.
   - `eyes`: per-eye hull of eye + eyebrow + upper-cheek landmarks, dilated by 25% of eye width. Feather = 30% of eye width.
4. Color match: mean/std transfer in Lab, computed in a ring just inside the mask edge, applied to the warped patch.
5. Blend: Laplacian pyramid blending in the ROI (5 levels, mask Gaussian pyramid). If `cv.seamlessClone` exists in the loaded build and `config.USE_POISSON` is set, use it with `NORMAL_CLONE` instead. Default is pyramid.
6. Write the ROI back into the base canvas.

Render the preview at screen resolution (fast, re-render only the touched ROI on changes). Render full resolution only on export.

### 4.9 Export (`worker/encode.ts`)

- Full-res composite → `OffscreenCanvas.convertToBlob({ type: 'image/jpeg', quality: base.jpegQuality })`. Output dimensions equal the base frame's.
- EXIF: copy from the base frame via `piexifjs`. Keep: Make, Model, LensModel, DateTimeOriginal, OffsetTimeOriginal, SubSec*, FNumber, ExposureTime, ISO, FocalLength, FocalLengthIn35mmFilm, GPS*, ColorSpace. Set `Orientation = 1` (already baked). Update PixelXDimension/PixelYDimension. Software = APP_NAME.
- Filename: `<base original name>-keepershot.jpg`.
- Save: `navigator.canShare({ files })` → `navigator.share` (iOS saves to Photos); else an `<a download>` link.

---

## 5. UI

Mobile-first, one column, bright and minimal. Accent color in `config.ts`.

### Upload

Big drop/tap zone. "Pick 2–20 shots of the same group." Shows thumbnails and a **Start** button. If a previous session exists in IndexedDB: **Resume** / **Start over**.

### Progress (entertaining, event-driven)

The worker emits typed events; the UI renders a live feed plus a growing grid of face thumbnails grouped into person rows.

- "Loaded 6 photos (12.2 MP each)"
- "Photo 3/6: found 9 faces"
- "Aligned photo 4 — 812 matching points"
- "Grouped 9 people across 6 photos"
- Live counters: **faces found**, **people**, **blinks caught**, **looking away**, **funny faces**.
- Per person: a row of their thumbnails as they arrive, a red dot on blinks, the best one glowing.
- Final line: "Best base: photo 4 — needs 2 fixes" → auto-advance to Review after 1s.

A determinate progress bar: decode 10%, detect 40%, align 30%, group/score/select 5%, preview composite 15%.

### Review

- The composite fills the screen, with pinch-zoom/pan (`@panzoom/panzoom`).
- A badge on each face: ✓ base (grey), 👁 eyes swapped (blue), 🙂 face swapped (purple), ⚠ low confidence (amber: best total < 0.6 or only disabled alternatives).
- A **"Next to check"** button cycles through amber faces (essential for 20+ people).
- Tap a face → **FaceSheet** (bottom sheet):
  - A horizontal carousel of that person's candidates (one per frame), each with chips: 👁 eyes, ↗ gaze, 🙂 smile, total. Disabled candidates are greyed out with the reason.
  - An **Eyes / Face** segmented toggle (disabled options hidden).
  - The preview updates live in the composite behind the sheet.
  - **Confirm** / **Cancel**.
- **BaseStrip:** a filmstrip of frames with the needed-swap count under each; tap to change base (recomputes auto-picks, keeps manual picks where still feasible).
- Press-and-hold the composite to show the untouched base frame (before/after).
- **Save** button → export.

### Debug (`/#debug`)

Overlay toggles on any frame: landmarks, face boxes with person IDs, ORB inlier matches to ref, swap masks, per-face score table. Used for tuning thresholds with the user's fixture bursts.

---

## 6. Persistence

- IndexedDB keys: `frame:<id>` (original blob), `thumb:<faceId>`, `session` (JSON of `Session` without blobs).
- Save `session` after each pipeline stage and after every pick change. On load, if `session` exists, offer Resume and skip straight to Review (re-render the preview from stored data; no re-detection).
- **Start over** clears all keys.
- Call `navigator.storage.persist()` on first Start.

---

## 7. GitHub Pages deploy (`.github/workflows/deploy.yml`)

```yaml
name: deploy
on:
  push: { branches: [main] }
  workflow_dispatch:
permissions: { contents: read, pages: write, id-token: write }
concurrency: { group: pages, cancel-in-progress: true }
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run typecheck && npm run test
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: { name: github-pages, url: '${{ steps.d.outputs.page_url }}' }
    steps:
      - id: d
        uses: actions/deploy-pages@v4
```

Also add `.github/workflows/ci.yml` for PRs (typecheck + unit tests). In `README.md`, tell the user to set **Settings → Pages → Source = GitHub Actions** once.

npm scripts: `dev`, `build`, `preview`, `typecheck` (`tsc --noEmit`), `test` (vitest run), `e2e` (playwright).

---

## 8. Tests

- **Unit (Vitest), required:** geometry (compose/invert/similarity fit), pose extraction, group (synthetic boxes with jitter, missing faces, extra passer-by), score (blendshape fixtures), select (base choice, swap gain, mode rules, disabled reasons), jpegQuality (known DQT tables).
- **E2E (Playwright):** the app loads, the service worker registers, upload works. If `tests/fixtures/*/` contains images, run the full pipeline on each burst and assert: ≥1 person, a composite is rendered, export produces a JPEG with the same dimensions as the base and with EXIF DateTimeOriginal. Skip cleanly when there are no fixtures.
- `tests/fixtures/README.md` explains: one folder per burst, plus an optional `expected.json` (`{ "people": 5 }`).

---

## 9. Milestones (commit after each)

| #   | Milestone                                | Done when                                                                                   |
| --- | ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| 0   | Devcontainer                             | Container builds; user prompted to reopen                                                   |
| 1   | Scaffold + deploy                        | Vite/Preact/Tailwind/PWA skeleton live on GitHub Pages; CI green                            |
| 2   | Ingest + detect + debug overlay          | Landmarks drawn correctly on full-res iPhone photos (orientation correct)                   |
| 3   | Align + group                            | Debug view shows stable person IDs across frames on a handheld burst                        |
| 4   | Score + select                           | Auto-picks and base choice match human judgment on fixtures; unit tests pass                |
| 5   | Composite                                | Eyes and face swaps show no visible seam at 100% zoom on fixtures                           |
| 6   | Review UI                                | Tap face → sheet → change → confirm; base switch; before/after; next-to-check               |
| 7   | Export                                   | Same dimensions as base, EXIF preserved, saves to Photos via share sheet on iOS             |
| 8   | Progress feed + persistence + PWA polish | Entertaining progress; resume after reload; installable; offline after first load           |
| 9   | Perf/memory hardening                    | 10 × 12MP burst completes on a recent iPhone in Safari without a tab crash; under 30s total |

---

## 10. Out of scope (v1)

- Whole-head or whole-body swaps, and fixing body/arm motion.
- Live Photo frames.
- Manual "add a missed face".
- Identity embeddings (hook only).
- Generative seam repair.
- Accounts, sharing links, any backend.
