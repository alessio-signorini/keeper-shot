# Test fixtures

One folder per burst of near-identical group photos (JPEG/PNG/HEIC), e.g. `tests/fixtures/family-1/IMG_0001.jpg …`.

Optionally add `expected.json` to a folder to assert the number of people found:

```json
{ "people": 5 }
```

Fixture images are gitignored; `expected.json` files are tracked. When no burst folders exist, the full-pipeline e2e tests are skipped.
