# KeeperShot

Take several near-identical group photos; KeeperShot finds every face, groups faces by person, auto-picks the best face per person, lets you review/change picks, and composites one final photo where everyone looks good.

Runs entirely in the browser (PWA, no backend). Deployed to GitHub Pages.

## Develop

Open the folder in the devcontainer (VS Code: _Dev Containers: Reopen in Container_), then:

```sh
npm run dev         # vite dev server (5173)
npm run build       # typecheck + production build
npm run preview     # serve dist (4173)
npm run typecheck
npm run test        # unit tests (vitest)
npm run e2e         # playwright smoke + full-pipeline tests on tests/fixtures/*/
npm run format      # prettier (CI checks formatting)
```

Debug overlays (landmarks, boxes + person IDs, swap masks, score table): open `/#debug` after processing a burst.

## Deploy

Set **Settings → Pages → Source = GitHub Actions** once. Pushes to `main` build and publish via `.github/workflows/deploy.yml`.

## Renaming

Change `APP_NAME` in `src/config.ts` and in `vite.config.ts` (PWA manifest); also the `<title>` in `index.html` and the heading checked by `tests/e2e/smoke.spec.ts`. Exported files are named `<photo>-<app name in lowercase>.jpg`.

## Docs

- [AGENTS.md](AGENTS.md) — start here: commands, layout, rules
- [docs/architecture.md](docs/architecture.md) — pipeline, modules, coordinate spaces
- [docs/decisions.md](docs/decisions.md) — design decisions currently in effect
- [docs/future-work.md](docs/future-work.md) — queued naming and performance improvements
- [docs/history/original-spec.md](docs/history/original-spec.md) — the original build spec (historical)
