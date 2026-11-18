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

## Performance

Rough priority order, starting with the likely biggest wins. Measure before and after.

1. **The whole session is structured-cloned to the worker on every preview.** `renderPreview(session, picks, …)` sends every face's 2 × 478 landmarks (~1M numbers for a 50-person burst) on each pick change. Keep the session in the worker (send it once after Resume/analysis) and send only picks and base changes.
2. **Swap feasibility is recomputed many times over.** `chooseBase`, `rebase`, `swapCountByFrame` (main thread, on every session change) and every `FaceSheet` candidate render call `swapFeasibility`, which runs a similarity fit per (source, base) pair. Faces don't change after analysis, so cache it by `(srcFaceId, baseFaceId)`. `swapCountByFrame` alone does frames × people × frames fits per pick change.
3. **Landmark storage.** Store landmarks as `Float32Array` (or a flat `number[]`) instead of `[x, y][]`. That means less structured-clone and IndexedDB work for `saveSession` (called 3× during analysis plus on every pick). Persisted schema change.
4. **Tile scan overhead.** `detectFaces` calls `createImageBitmap` per tile (hundreds per frame). Try drawing tiles into one reusable canvas, or passing `ImageData`, and skip tiles that sit entirely outside the search region at coarse scales.
5. **`alignByFaces` is O(A²·B²).** Every face pair seeds a hypothesis that is scored by matching all pairs (~6M distance checks for 50 × 50 faces, per frame). Dedupe near-identical hypotheses, or use a spatial grid in `matchFaces`.
6. **`mergeFragments` recomputes `meanBox`/`span` inside its O(n²) loop on every merge.** Cache them per cluster.
7. **Per-face canvases.** `sharpnessOf` and `faceThumb` (`worker/lib/faceCrops.ts`) allocate a new `OffscreenCanvas` per face; reuse one.
8. **Progress feed.** `detectedFaces`/`progressLog` copy their arrays on every event (O(n²) for ~400 faces). Batch updates per frame.
9. **Code splitting.** Lazy-load `ui/Debug.tsx` and `@panzoom/panzoom` (Review only).

## Other

- `npm run e2e` fails on 3 of 4 fixtures because `expected.json` holds target counts that the pipeline doesn't reach yet. Consider recording both a `target` and the current `baseline`, and asserting the baseline, so e2e catches regressions instead of always being red.
- A committed snapshot test, run with `npm run e2e:snapshot`, would make refactor checks one command. It would record people, base, picks and the exported-JPEG hash per fixture and compare them with the stored values.
- The big-family export (9 × 20 MP) can crash Chromium in a ~4 GB container while VS Code is running; e2e on that fixture needs headroom.
- `Renderer.exportJpeg` closes the base bitmap twice (`releaseBase` and `finally`), which is harmless. Only one of them is needed.
- `isHeic` (`worker/lib/decode.ts`) treats an empty MIME type as HEIC, so any undecodable file without a type goes to libheif.
- docs/decisions.md says source frames are decoded whole because crop + orientation is inconsistent across browsers. `createImageBitmap` with `resizeWidth` on a cropped region could reduce export memory if that's re-tested.
