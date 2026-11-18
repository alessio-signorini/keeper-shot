# Decisions

The design choices currently in effect, grouped by topic. When behaviour changes, edit the right section: replace entries that no longer hold instead of appending contradictions. Tunable numbers are named here by their `src/config.ts` constant.

## Platform and build

- One ES-module pipeline worker. MediaPipe's and OpenCV's loaders call `importScripts`, which module workers don't have, so `worker/lib/opencv.ts` shims it with a synchronous XHR + global eval.
- OpenCV.js, the MediaPipe wasm files and libheif are copied to `dist/` (flattened) by vite-plugin-static-copy and precached by the service worker, so the app works offline.
- The OpenCV.js build lacks `estimateAffinePartial2D` and `seamlessClone`: the similarity fallback is a small JS RANSAC (`core/ransac.ts`) and Laplacian-pyramid blending is always used.
- Playwright launches Chromium with `--disable-dev-shm-usage --disable-gpu` (the container's /dev/shm is tiny); the 20 MP `family` fixture needs ~1 GB free for the browser.

## Ingest

- Frames are sorted by `DateTimeOriginal` (+ `SubSecTimeOriginal`); frames without it keep file order after the dated ones.
- Upload thumbnails are decoded one at a time at `THUMB_PX`; EXIF is read sequentially.

## Detection

- MediaPipe's detector shrinks its input to ~128 px and only finds faces covering ~1/6 of it, so every frame is scanned whole plus with overlapping tiles at several scales (`core/detectionTiles.ts`: `MIN_FACE_FRAC`, `TILE_PER_FACE`, `TILE_COARSEST_FRAC`, `TILE_STEP`). After the first frame, scales finer than `TILE_REGION_BELOW` × long edge only scan the region where the group was found in the previous frame.
- Faces cut by an interior tile edge are discarded (an overlapping tile sees them whole); duplicates merge on IoU (`TILE_MERGE_IOU`) or centre-in-box.
- Every candidate is re-run through the landmarker on a full-resolution crop (`REFINE_*`): this rejects hands/props and gives landmarks, blendshapes, sharpness and thumbnails from full-res pixels. Candidates whose gaze blendshapes saturate in several directions (`GAZE_SATURATED*`) are rejected as non-faces; in frames with ≥ `MIN_REL_FACE_COUNT` faces, faces smaller than `MIN_REL_FACE` × the median are dropped.
- Detection uses the CPU (XNNPACK) delegate: hundreds of tiny tile inferences are ~7× faster than WebGL, where GPU readback dominates.
- One `FaceLandmarker` instance switches options between scanning and refining (a second instance cost ~100 MB of WASM heap). It is closed after the detect pass so OpenCV loads with less memory pressure.
- Printed faces (e.g. a photo cutout) are detected as people, by design.

## Alignment

- The reference frame is the middle frame by time.
- Background alignment: ORB on grayscale at `ALIGN_LONG_EDGE`, with face boxes masked out (`ALIGN_MASK_*`), kNN + Lowe ratio, RANSAC homography validated for inliers, perspective and scale; else a RANSAC similarity; else identity (warning).
- Face alignment (`core/faceAlignment.ts`): face-pair seeds, then a similarity fit on eye/nose/mouth landmarks of matched faces. Whichever transform lines up more faces with the reference frame becomes `toRef` (`Frame.alignMethod`). Needed when the background aligns differently from the group (parallax, grass). A similarity (not affine/homography) keeps single-row groups stable.
- Frames where fewer than `FRAME_MIN_ALIGNED` of the reference frame's faces line up are left out (warning logged), as long as `FRAME_MIN_KEPT` frames remain.

## Grouping into people

- Faces are matched to clusters by Hungarian assignment on IoU + centre distance; a match is accepted on `GROUP_MIN_IOU` or within `GROUP_MAX_DIST` face widths.
- Fragments that never share a frame merge when their distance is within `GROUP_MERGE_BASE + GROUP_MERGE_PER_FRAME × frame gap` (people who moved).
- Clusters seen in fewer than `GROUP_MIN_FRAME_FRACTION` of frames are dropped (passers-by), as are people whose median sharpness is below `MIN_REL_SHARPNESS` × the median person's (out-of-focus background mistaken for a face). Faces not assigned to a kept person are removed from the session.
- Known limitation: kids who move relative to the group can still split into separate "people" (position-only grouping; an identity-embedding model would fix this).

## Scoring

- `total` is a weighted sum (`SCORE_WEIGHTS`) of eyes, gaze, pose, smile (minus a funny-face penalty) and sharpness normalised within the person.
- A blink is flagged when eyes < `BLINK_THRESHOLD` or < `BLINK_REL` × the person's most-open eyes in the burst (baseline openness varies by person and smile); blinks multiply the total by `BLINK_PENALTY`.

## Selection

- Base frame: the highest achievable summed score (each person at their best feasible face) wins. Sums within `BASE_SUM_TOL` × people count as equal and then prefer fewer swaps, more best faces already in place (`WIN_EPSILON`), then the reference frame, then more alignment inliers.
- A person is swapped to their best feasible face when it beats the base face by `SWAP_GAIN_MIN`. Eyes-only swaps are used when the smiles are similar (`SMILE_SIMILAR`) and the base face has no funny-face penalty.
- A person not detected in the base frame defaults to `skip` (paste nothing): they are usually still there but turned away, and pasting created doubled "ghost" faces. They are amber ("check") only if seen in at least half the frames.
- Amber also marks faces whose final score is below `LOW_CONFIDENCE_TOTAL`.
- In the face sheet, infeasible candidates are not disabled: tapping one forces a face swap ("tap to force"). Auto-selection still respects feasibility.

## Compositing

- Source patches are warped with `cv.warpAffine` (Lanczos) on just the source region the ROI needs; masks, Lab colour transfer and pyramid blending use OpenCV.
- Source frames are decoded whole (not cropped) because `createImageBitmap` crop + EXIF orientation behaves inconsistently across browsers.
- Face swaps measure colour-match statistics over the skin interior (face oval shrunk to 80%, minus brows/eyes/mouth, only where the source covers the ROI), falling back to a ring inside the mask edge if too small; eye swaps use the ring.
- The preview uses an incremental `Compositor`: a pick change restores only the affected ROIs from the base and re-blends them plus any overlapping picks, in stable person order.
- Known limitation: a hand or prop covering part of the source face is pasted along with it.

## Memory

- The pipeline worker is terminated after analysis (WASM heaps never shrink); previews decode straight to the target size with `createImageBitmap` resize and are kept in a small LRU cache; export frees the preview caches first. Needed because 20 MP bursts crashed the renderer in ~2 GB containers.

## Review UI

- Each face gets a coloured rectangle (white = base, blue = eyes swapped, purple = face swapped, amber = check, dashed = skipped) with a small status chip; ◻︎ toggles the markers.
- Wheel/pinch/+− zoom; once zoomed the photo can be dragged, with the pan clamped by hand in `panzoomchange` so it always covers its frame (panzoom's own `contain` mis-positioned the centred stage).
- Press-and-hold shows the untouched base frame.

## Export

- Save uses the share sheet only on phones/tablets (where it offers Photos/Files); on desktop it downloads. A separate ⬇ button always downloads.
- EXIF: the allow-listed tags are copied from the base JPEG via piexifjs, falling back to the parsed EXIF (Make/Model/DateTimeOriginal) for non-JPEG bases such as HEIC. Orientation is reset to 1 and pixel dimensions updated.

## Debug

- `/#debug` shows landmarks, boxes + person IDs, swap masks, sampled ORB inlier matches (stored per frame), alignment method/inliers/`toRef` and the score table.

## Fixture status

People found by the e2e full-pipeline test vs `expected.json` (2026-11-18): big-family 47/52, family 14/14, kids 23/19, portrait 2/1. Over-splitting of moving subjects, cutouts and a few undetected faces explain the gaps. Update this line when the counts change.
