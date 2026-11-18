# Deployment

KeeperShot is a static, client-only PWA deployed to GitHub Pages.

## One-time setup

In the repository, set **Settings → Pages → Source = GitHub Actions**.

## Publishing

Pushes to `main` build and publish via [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml). CI checks (formatting, typecheck, tests) run via [`ci.yml`](../.github/workflows/ci.yml).

The Vite `base` path is derived from `GITHUB_REPOSITORY`, so the site works under `https://<user>.github.io/<repo>/`.

## Local production build

```sh
npm run build
npm run preview   # serves dist on 4173
```

Any static host works; there is no backend and no runtime network calls besides the app's own assets.
