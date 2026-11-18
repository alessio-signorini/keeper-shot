# Future work

Improvements noticed during the 2026-11 cleanup and deliberately left for a later phase. Each needs its own change and verification (see "Checking a refactor" in [AGENTS.md](../AGENTS.md)).

## Naming

### Persisted fields

These are part of `Session`, which is saved in IndexedDB for Resume. Renaming them needs a schema version (e.g. a `version` field checked in `loadSavedSession`, discarding or migrating old sessions).

| Now                           | Suggested                     | Why                                                                            |
| ----------------------------- | ----------------------------- | ------------------------------------------------------------------------------ |
| `Face.blend`                  | `blendshapes`                 | Says what it holds (MediaPipe blendshape scores)                               |
| `FaceScore.sharp`             | `sharpness`                   | Pairs with `Face.sharpness` (raw); this is the normalised value                |
| `Person.faces`                | `faceIdByFrame`               | It's a frameId → faceId map, not a list of faces                               |
| `Session.picks`               | `picksByPerson`               | Matches the `PicksByPerson` type                                               |
| `Frame.alignInliers`          | `backgroundInliers`           | Only counts ORB (background) alignment                                         |
| `Frame.matches`               | `debugMatches`                | Only used by `/#debug`                                                         |
| `Face.box` / `Face.landmarks` | `frameBox` / `frameLandmarks` | Makes the coordinate space explicit next to `refBox` / `refLandmarks`          |
| `PickMode` `'base'`           | `'keep'`                      | "Keep the base face"; `base` is overloaded (base frame, base face, base score) |

### Code-only names

| Now                                                                 | Suggested                                                           | Where                                                                        |
| ------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `groupFaces`                                                        | `groupIntoPeople`                                                   | `core/grouping.ts`                                                           |
| `scoreAlignment` / `FaceAlignment { m, matched, err }`              | `measureFaceAlignment` / `{ transform, matchedFaces, medianError }` | `core/faceAlignment.ts`                                                      |
| `fitSimilarity` → `{ m, rms }`                                      | `{ transform, rms }`                                                | `core/geometry.ts` (`m` is used for matrices everywhere)                     |
| `Feasibility.dpose`                                                 | `poseDelta`                                                         | `core/feasibility.ts`                                                        |
| `BaseEvaluation.sum`                                                | `totalScore`                                                        | `core/baseFrame.ts`                                                          |
| `PipelineEvent` `'thumb'` / `'detected'`                            | `'faceFound'` / `'frameScanned'`                                    | `types.ts`, `app/actions.ts`, `app/pipelineLog.ts`                           |
| `'scan' \| 'full'` landmarker modes                                 | `'scan' \| 'refine'`                                                | `worker/lib/mediapipe.ts` (matches `refineFace` and `REFINE_*`)              |
| `AlignFeatures { w, h, gray, masks }`                               | `{ width, height, gray, ignoreBoxes }`                              | `worker/lib/orb.ts`                                                          |
| `app.tsx`                                                           | `App.tsx`                                                           | Component file casing like `ui/*.tsx`                                        |
| One-letter names in long functions (`s`, `L`, `t`, `fs`, `fr`, `k`) | `session`, `landmarks`, `mats`, …                                   | Mostly `core/grouping.ts`, `core/masks.ts`, `worker/render/blend.ts`, `ui/*` |

### Config

- `MIN_REL_FACE_COUNT` gates both small-face rejection (faces per frame) and blurry-people rejection (people per burst). Split it into `SMALL_FACE_MIN_FACES` and `BLURRY_PEOPLE_MIN_PEOPLE`.
- `ALIGN_SCALE_MIN/MAX` validate both ORB homographies and face-alignment hypotheses; give them separate names if they ever need different values.
- Group the detection names by prefix: `MIN_FACE_CONFIDENCE` and `REFINE_PRESENCE` are both refine settings; `SCAN_CONFIDENCE` is a scan setting.
- Mixed import styles: most modules use `import * as C from '../config'`, but `Upload.tsx` and `jpegEncode.ts` use named imports. Pick one.

## Memory

Chromium renderer RSS after the blend and session-in-worker changes (2026-11-18): family (20 MP) 564 MB in Review / 672 MB export peak; big-family (9 × 20 MP) 644 / 793 MB; 13 MP close-up 499 / 666 MB. Analysis peaks around 530–565 MB. All items below keep the output pixel-identical.

1. **Don't decode whole source frames for export.** `warpPatch` only reads a small rectangle of each source frame, but export decodes each source at full resolution (80 MB at 20 MP) while the 80 MB output canvas is alive. Saving lossless (PNG) full-res crops around every face during the detect pass, when the bitmap is already decoded, removes that from the export peak: about −80 MB of the +190 MB. Keep a full decode as the fallback when the needed rectangle isn't covered. Cost: IndexedDB space, roughly 0.2–0.3 MB per face for group shots.
2. **Cache face regions instead of whole frames for the preview.** `FrameCache` holds up to 6 frames at preview size (≈ 7 MB each). Keeping only the face ROIs cut from the same decoded bitmaps gives identical pixels for about −35 MB in Review.
3. **Landmarks as typed arrays.** See Performance item 1: −22 MB of heap per live session copy.
4. **OpenCV build.** `opencv.js` is a 13 MB script with the wasm embedded, eval'd via sync XHR. A custom build with only core/imgproc/features2d/calib3d and a separate streamed `.wasm` would load much less code. Use the same OpenCV version and build flags to keep results identical.

## Performance

Rough priority order, starting with the likely biggest wins. Measure before and after.

1. **Landmark storage.** Store landmarks as `Float64Array` (exact same values) instead of `[x, y][]`: 29 MB → 6.6 MB of heap for 423 faces, and clones become memcpy. Not persisting `refLandmarks` (recompute `applyAll(toRef, landmarks)`, which is deterministic) halves it again to 3.3 MB. This is a persisted schema change.
2. **Tile scan overhead.** `detectFaces` calls `createImageBitmap` per tile (hundreds per frame). Try drawing tiles into one reusable canvas, or passing `ImageData`, and skip tiles that sit entirely outside the search region at coarse scales.
3. **`alignByFaces` is O(A²·B²).** Every face pair seeds a hypothesis that is scored by matching all pairs (~6M distance checks for 50 × 50 faces, per frame). Dedupe near-identical hypotheses, or use a spatial grid in `matchFaces`.
4. **`mergeFragments` recomputes `meanBox`/`span` inside its O(n²) loop on every merge.** Cache them per cluster.
5. **Per-face canvases.** `sharpnessOf` and `faceThumb` (`worker/lib/faceCrops.ts`) allocate a new `OffscreenCanvas` per face; reuse one.
6. **Progress feed.** `detectedFaces`/`progressLog` copy their arrays on every event (O(n²) for ~400 faces). Batch updates per frame.
7. **Code splitting.** Lazy-load `ui/Debug.tsx` and `@panzoom/panzoom` (Review only).
8. **Swap feasibility is recomputed** by `chooseBase`, `rebase`, `swapCountByFrame` and each `FaceSheet` candidate. Measured warm in Node for 47 people × 9 frames: `swapCountByFrame` takes 1.7 ms, of which feasibility is about 1 ms. Low value; if wanted, a `WeakMap` cache keyed by the (immutable after analysis) `Face` objects in `core/feasibility.ts` is about 15 lines.

## Other

- `npm run e2e` fails on 3 of 4 fixtures because `expected.json` holds target counts that the pipeline doesn't reach yet. Consider recording both a `target` and the current `baseline`, and asserting the baseline, so e2e catches regressions instead of always being red.
- A committed snapshot test, run with `npm run e2e:snapshot`, would make refactor checks one command. It would record people, base, picks and the exported-JPEG hash per fixture and compare them with the stored values.
- The big-family export (9 × 20 MP) peaks around 790 MB of renderer RSS. It completes in a ~4 GB container with VS Code running, but only just; it crashed there before the blend and session-in-worker changes.
- `Renderer.exportJpeg` closes the base bitmap twice (`releaseBase` and `finally`), which is harmless. Only one of them is needed.
- `isHeic` (`worker/lib/decode.ts`) treats an empty MIME type as HEIC, so any undecodable file without a type goes to libheif.
- docs/BUILD.md says source frames are decoded whole because crop + orientation is inconsistent across browsers. `createImageBitmap` with `resizeWidth` on a cropped region could reduce export memory if that's re-tested.
