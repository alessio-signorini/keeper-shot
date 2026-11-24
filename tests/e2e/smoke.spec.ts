import { expect, test } from '@playwright/test';
import exifr from 'exifr';
import fs from 'node:fs';
import path from 'node:path';

const fixturesDir = path.resolve('tests/fixtures');
const bursts = fs.existsSync(fixturesDir)
  ? fs
      .readdirSync(fixturesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(fixturesDir, d.name))
  : [];
const imagesIn = (dir: string) =>
  fs
    .readdirSync(dir)
    .filter((f) => /\.(jpe?g|png|heic)$/i.test(f))
    .sort()
    .map((f) => path.join(dir, f));

/** Width/height from the first SOF marker. */
function jpegSize(b: Buffer): [number, number] {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
      return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
    i += 2 + b.readUInt16BE(i + 2);
  }
  return [0, 0];
}

test('app loads, registers the service worker and shows the upload screen', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'KeeperShot' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start' })).toBeDisabled();
  const sw = await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state);
  expect(sw).toBeTruthy();
});

test('upload enables Start and shows thumbnails', async ({ page }) => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles([
    { name: 'a.png', mimeType: 'image/png', buffer: png },
    { name: 'b.png', mimeType: 'image/png', buffer: png },
  ]);
  await expect(page.getByText('2 selected')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start' })).toBeEnabled();
});

for (const dir of bursts) {
  const images = imagesIn(dir);
  test(`full pipeline: ${path.basename(dir)}`, async ({ page }) => {
    test.skip(images.length < 2, 'needs at least two images');
    await page.goto('/');
    await page.locator('input[type=file]').setInputFiles(images);
    // let the page finish decoding thumbnails first: overlapping with the worker's decode of 20MP photos exhausts small CI/containers
    // photo thumbnails are labelled with their file names (the decorative logo has alt="")
    await expect(page.locator('img:not([alt=""])')).toHaveCount(images.length, { timeout: 60_000 });
    await page.getByRole('button', { name: 'Start' }).click();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible({ timeout: 150_000 });

    const people = await page.locator('button[aria-label^="Person"]').count();
    expect(people).toBeGreaterThanOrEqual(1);
    const expectedFile = path.join(dir, 'expected.json');
    if (fs.existsSync(expectedFile)) expect(people).toBe(JSON.parse(fs.readFileSync(expectedFile, 'utf8')).people);

    const hasPreview = await page.locator('canvas').evaluate((c: HTMLCanvasElement) => c.width > 0 && c.height > 0);
    expect(hasPreview).toBe(true);

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 120_000 }),
      page.getByRole('button', { name: 'Save', exact: true }).click(),
    ]);
    const out = fs.readFileSync((await download.path())!);
    expect(out[0]).toBe(0xff);
    expect(out[1]).toBe(0xd8);
    const meta = await exifr.parse(out, { pick: ['DateTimeOriginal', 'ExifImageWidth', 'ExifImageHeight'] });
    const dims = jpegSize(out);
    expect(dims[0]).toBeGreaterThan(0);
    if (meta?.ExifImageWidth) expect([meta.ExifImageWidth, meta.ExifImageHeight]).toEqual(dims);
    // EXIF DateTimeOriginal is preserved when the source has it
    const srcMeta = await exifr.parse(fs.readFileSync(images[0]), { pick: ['DateTimeOriginal'] });
    if (srcMeta?.DateTimeOriginal) expect(meta?.DateTimeOriginal).toBeTruthy();
  });
}
