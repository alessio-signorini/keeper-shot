# Development

## Setup

Open the folder in the devcontainer (VS Code: _Dev Containers: Reopen in Container_), then `npm install` if dependencies are missing.

## Commands

```sh
npm run dev         # vite dev server (5173)
npm run build       # typecheck + production build
npm run preview     # serve dist (4173)
npm run typecheck   # tsc --noEmit
npm run test        # unit tests (vitest)
npm run e2e         # playwright smoke + full-pipeline tests on tests/fixtures/*/
npm run format      # prettier (CI checks formatting)
```

Run `format`, `typecheck` and `test` before finishing any change. Run `e2e` when touching the worker, the pipeline or UI flows.

## Testing

- **Unit tests** (`tests/unit/*.test.ts`) cover the pure logic in `src/core/`.
- **E2E tests** (`tests/e2e/`) are Playwright smoke tests plus a full-pipeline run on each burst folder in `tests/fixtures/`. They are slow (~2 min) and need ~1 GB of free RAM. See [tests/fixtures/README.md](../tests/fixtures/README.md) for the fixture layout and `expected.json`.

## Debugging

Debug overlays (landmarks, boxes + person IDs, swap masks, score table): open `/#debug` after processing a burst.

## Renaming the app

Change `APP_NAME` in `src/config.ts` and in `vite.config.ts` (PWA manifest); also the `<title>` in `index.html` and the heading checked by `tests/e2e/smoke.spec.ts`. Exported files are named `<photo>-<app name in lowercase>.jpg`.

## See also

- [architecture.md](architecture.md) — pipeline and modules
- [BUILD.md](BUILD.md) — build spec and design decisions
- [AGENTS.md](../AGENTS.md) — code placement rules
