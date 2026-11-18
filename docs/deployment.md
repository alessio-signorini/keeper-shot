# Deployment

KeeperShot is a static, client-only PWA deployed to GitHub Pages.

## One-time setup

In the repository, set **Settings → Pages → Source = Deploy from a branch**, branch `gh-pages`, folder `/ (root)`. The branch is created by the first deploy run.

## Publishing

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) checks formatting, runs unit tests and builds (which includes typecheck) on every pull request and push. Pushes to `main` additionally publish `dist` to the `gh-pages` branch with `peaceiris/actions-gh-pages`.

The site is served from the root of the custom domain `keepershot.signorini.dev` (`public/CNAME`, Vite `base: '/'`). DNS: a `CNAME` record for `keepershot` pointing to `alessio-signorini.github.io`. Set the custom domain and enable _Enforce HTTPS_ under Settings → Pages.

## Local production build

```sh
npm run build
npm run preview   # serves dist on 4173
```

Any static host works; there is no backend and no runtime network calls besides the app's own assets.
