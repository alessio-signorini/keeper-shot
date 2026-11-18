# Architecture

How KeeperShot is put together. For why specific choices were made, see [BUILD.md](BUILD.md); for working rules, [AGENTS.md](../AGENTS.md).

## Runtime overview

```
main thread (Preact)                                   pipeline worker (Comlink)
──────────────────────                                 ──────────────────────────────────────────
ui/Upload ──startAnalysis()──▶ app/actions ──────────▶ analyzeBurst(files, emit)
ui/Progress ◀── signals ◀── onPipelineEvent ◀─ emit ──   stages/ingest → stages/detectPass → stages/alignPass
                                                        → core/faceAlignment.misalignedFrames → core/analyze
                 (worker terminated after analysis: WASM heaps never shrink)
ui/Review ──refreshPreview()/setPick()/setBase()─────▶ setSession (once) + renderPreview / renderFrame / exportJpeg
                                                         (fresh worker; calls send only baseFrameId + picks)
                                                         render/renderer → render/compositor → render/blend
```

The worker writes the originals, thumbnails and `Session` to IndexedDB as it goes (`src/storage.ts`), so a reload can Resume straight into Review.

## Modules

| Path                            | Role                                                                                                                                                                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main.tsx`, `src/app.tsx`   | Mount, service worker, screen router (`upload` / `progress` / `review`, plus `#debug`)                                                                                                                                            |
| `src/config.ts`                 | Tunable thresholds and sizes                                                                                                                                                                                                      |
| `src/types.ts`                  | Data model (persisted) and `PipelineEvent`                                                                                                                                                                                        |
| `src/storage.ts`                | IndexedDB keys (`frame:`, `fthumb:`, `thumb:`, `session`) and access                                                                                                                                                              |
| `src/app/store.ts`              | Signals: screen, session, progress feed, preview bitmap; derived `attentionPersonIds`, `swapCountByFrame`                                                                                                                         |
| `src/app/actions.ts`            | Everything that mutates state: start/resume/start over, picks, base, preview refresh, save                                                                                                                                        |
| `src/app/workerClient.ts`       | Lazily starts / recycles the worker                                                                                                                                                                                               |
| `src/app/pipelineLog.ts`        | `PipelineEvent` → progress-feed line                                                                                                                                                                                              |
| `src/app/save.ts`               | Share sheet on mobile, download elsewhere                                                                                                                                                                                         |
| `src/app/useStoredUrl.ts`       | Hook: object URL for a stored blob                                                                                                                                                                                                |
| `src/ui/*`                      | Screens (`Upload`, `Progress`, `Review`), `FaceSheet`, `FaceMarkers`, `BaseStrip`, `Debug`                                                                                                                                        |
| `src/worker/pipeline.worker.ts` | Orchestrates analysis; exposes the API; serialises render calls                                                                                                                                                                   |
| `src/worker/stages/`            | `ingest` (EXIF, sort, JPEG quality), `detectPass`, `alignPass`                                                                                                                                                                    |
| `src/worker/render/`            | `renderer` (preview/export entry points), `compositor` (incremental canvas), `blend` (OpenCV colour match + pyramid blend), `frameCache`                                                                                          |
| `src/worker/lib/`               | Wrappers: `mediapipe` (face landmarker, tiled scan, refine), `opencv` (loader, `importScripts` shim, Mat tracking), `orb` (background alignment), `decode` (incl. HEIC), `faceCrops` (sharpness, thumbnails), `jpegEncode` (EXIF) |
| `src/core/`                     | Pure logic, below                                                                                                                                                                                                                 |

### core/

| Module                | Contents                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| `geometry`            | `Mat3` ops, boxes, IoU, similarity fit, convex hull, box expansion                             |
| `stats`               | `clamp`, `median`                                                                              |
| `landmarks`           | Every MediaPipe landmark index set                                                             |
| `session`             | Lookups: `frameById`, `baseFrame`, `personById`, `personOfFace`, `faceInFrame`, `facesOfFrame` |
| `detectionTiles`      | Tile sizes and tile plan for the face scan; search region from the previous frame              |
| `detectionFilters`    | Small-outlier and implausible-gaze rejection                                                   |
| `pose`, `jpegQuality` | Euler angles from MediaPipe's matrix; JPEG quality from DQT tables                             |
| `faceAlignment`       | Align frames by faces; choose background vs. face transform; frames to leave out               |
| `ransac`, `hungarian` | RANSAC similarity fit; min-cost assignment                                                     |
| `grouping`            | Faces → people across frames; drop blurry "people"                                             |
| `scoring`             | Per-face score components and total; quick progress flags                                      |
| `feasibility`         | Whether a face can replace the base face (eyes / face), and the auto mode                      |
| `picks`               | Per-person automatic pick, `rebase`, `needsAttention`, `isSwap`                                |
| `baseFrame`           | Evaluate each frame as base; choose the base                                                   |
| `analyze`             | Grouping → scoring → base choice, as one function                                              |
| `masks`               | Face / eye mask polygons and the skin region for colour statistics                             |
| `placement`           | Source→base transform, where a swap lands, incremental update planning                         |

## Coordinate spaces

| Space                                        | Where                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| Full-res frame px (orientation applied)      | `Face.landmarks`, `Face.box`, `Frame.width/height`                       |
| Working px (`WORK_LONG_EDGE`)                | Face scan in `detectPass` only; boxes are scaled back to full-res        |
| Align px (`ALIGN_LONG_EDGE`)                 | ORB features in `lib/orb`; `toRef` is scaled back to full-res            |
| Reference px (reference frame's full-res px) | `Face.refLandmarks`, `Face.refBox`; `Frame.toRef` maps into it           |
| Output px (`scale` × full-res)               | Compositor canvas: preview (`PREVIEW_LONG_EDGE`) or export (`scale = 1`) |

## Analysis pipeline

Progress weights are `PROGRESS` in config.

1. **Ingest** (`stages/ingest`): read EXIF and JPEG quality one file at a time; sort by capture time; create `Frame`s.
2. **Detect** (`stages/detectPass`), one full-res bitmap at a time:
   - store the original;
   - scan the whole frame plus multi-scale tiles at working resolution (`lib/mediapipe.detectFaces`, `core/detectionTiles`);
   - re-run every candidate on a full-res crop (`refineFace`) and drop small outliers;
   - store face and frame thumbnails;
   - keep a grayscale align-size copy with face boxes masked.
     The face model is closed afterwards.
3. **Align** (`stages/alignPass`): reference = middle frame. ORB + RANSAC homography (fallback: RANSAC similarity, then identity). Per frame, keep the background transform or the face-based one (`core/faceAlignment.chooseFrameTransform`), whichever lines up more faces. Map all faces into reference coords.
4. **Leave out** frames whose faces don't line up (`misalignedFrames`).
5. **Analyse** (`core/analyze`): group into people, drop blurry ones, score faces within each person, choose the base frame and automatic picks.

## Rendering

- **Session in the worker**: `setSession` loads the analysed session once per worker (`app/workerClient.rendererFor` sends it when `session.faces` changes identity). Render calls pass only `baseFrameId` and picks.
- **Preview**: `Renderer.renderPreview` keeps one `Compositor` per (base frame, scale). On pick changes, `core/placement.planIncrementalUpdate` decides which ROIs to restore from the base copy and which swaps to redo (changed ones plus anything overlapping, transitively). Source frames come from a small LRU `FrameCache`, decoded straight to preview size.
- **Swap** (`compositor.applySwap`): warp only the needed source region (Lanczos), rasterise the mask and skin polygons, then `blend.blendPatch`: feather the mask, Lab mean/std colour transfer (skin interior for face swaps, edge ring otherwise), Laplacian-pyramid blend. Mats are released as soon as they are dead and the pyramid is processed level by level: the WASM heap keeps its high-water mark, which scales with the ROI area.
- **Export**: frees preview caches, renders at full resolution with a one-shot compositor, encodes JPEG at the base frame's estimated quality and copies allow-listed EXIF (`lib/jpegEncode`).

## Testing

- `tests/unit/<module>.test.ts` cover `core/` (`factories.ts` builds synthetic faces/frames).
- `tests/e2e/smoke.spec.ts`: app load + service worker, upload, and a full pipeline run per `tests/fixtures/<burst>/` (images gitignored; `expected.json` tracked) that checks people count, preview and exported JPEG/EXIF.
