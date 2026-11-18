# AGENTS.md

Start here. KeeperShot is a client-only PWA (Preact + Vite + TypeScript) that merges a burst of near-identical group photos into one where everyone looks good. Everything runs in the browser; heavy work runs in one Web Worker.

## Read next

| Need                                           | Read                                         |
| ---------------------------------------------- | -------------------------------------------- |
| How the pipeline, data model and modules fit   | [docs/architecture.md](docs/architecture.md) |
| Full build spec + why things behave as they do | [docs/BUILD.md](docs/BUILD.md)               |
| Tunable thresholds                             | [src/config.ts](src/config.ts)               |
| Ideas queued for a future phase (names, perf)  | [docs/future-work.md](docs/future-work.md)   |

## Commands

```sh
npm run typecheck     # tsc --noEmit
npm run test          # vitest: tests/unit/*.test.ts
npm run format        # prettier --write . (CI runs format:check)
npm run build         # typecheck + production build
npm run e2e           # playwright: smoke tests + full pipeline on tests/fixtures/*/ (slow, ~2 min, needs ~1 GB free RAM)
```

Run `format`, `typecheck` and `test` before finishing any change. Run `e2e` when touching the worker, the pipeline or UI flows. Full-pipeline e2e tests assert `expected.json` people counts, several of which are known to differ today (see "Tests" in docs/BUILD.md); compare against the previous run rather than expecting green.

## Where code goes

```
src/core/     pure logic: no DOM, canvas, WASM or IndexedDB; unit-tested in tests/unit/<module>.test.ts
src/worker/   pipeline worker: stages/ (analysis passes), render/ (preview + export), lib/ (MediaPipe, OpenCV, codecs)
src/app/      main-thread state (signals), actions, worker client
src/ui/       Preact components; read signals from app/store, call app/actions
src/storage.ts  IndexedDB keys and access, shared by worker and main thread
src/types.ts    shared data model (persisted in IndexedDB)
src/config.ts   tunable thresholds and sizes
```

Dependency direction: `ui → app → (worker via Comlink) → core`. `core` imports only `core`, `types` and `config`. `ui` never imports `worker`.

## Rules

- If logic doesn't need the DOM, canvas, WASM or IndexedDB, put it in `src/core/` and add a focused test.
- Tunable thresholds go in `src/config.ts`. Fixed implementation constants are named `const`s at the top of the file that uses them, with a one-line comment. No unnamed numbers in logic.
- MediaPipe landmark indices live only in `src/core/landmarks.ts`.
- Look up frames, people and faces through `src/core/session.ts` (`frameById`, `baseFrame`, `personById`, `faceInFrame`, `facesOfFrame`, `personOfFace`), and storage keys through `src/storage.ts`.
- Name coordinate spaces in variables when it isn't obvious: full-res frame px, `work*` (WORK_LONG_EDGE), `align*` (ALIGN_LONG_EDGE), `ref*` (reference frame), output/preview px (`scale`).
- `Session` and everything in it is persisted for Resume. Renaming or reshaping a persisted field breaks saved sessions unless loading handles the old shape.
- Memory: never hold more than one full-resolution bitmap at a time in the analysis passes; `close()` bitmaps and free every OpenCV Mat (`withMats`/`withMatsSync`), releasing large ones as soon as they're dead (`Tracker.release`): the WASM heap never shrinks, so its peak is what counts.
- No backend, analytics or runtime network calls besides the app's own static assets.
- When behaviour changes, update the matching section of `docs/BUILD.md` (replace outdated entries; don't append contradictions).
- Prettier formatting, one statement per line.

## Checking a refactor

A behaviour-preserving change should leave the pipeline output identical: the same people, base frame and picks for each fixture, and a byte-identical exported JPEG (rendering is deterministic). Capture these before and after (e.g. read the `session` key from IndexedDB and hash the downloaded file in a Playwright script).
