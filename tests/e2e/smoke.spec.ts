import { expect, test } from '@playwright/test';
import exifr from 'exifr';
import fs from 'node:fs';
import path from 'node:path';

const fixturesDir = path.resolve('tests/fixtures');
const bursts = fs.existsSync(fixturesDir)
  ? fs.readdirSync(fixturesDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(fixturesDir, d.name))
  : [];
const imagesIn = (dir: string) =>
  fs.readdirSync(dir).filter((f) => /\.(jpe?g|png|heic)$/i.test(f)).sort().map((f) => path.join(dir, f));

test('app loads, registers the service worker and shows the upload screen', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'KeeperShot' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start' })).toBeDisabled();
  const sw = await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state);
  expect(sw).toBeTruthy();
});

test('upload enables Start and shows thumbnails', async ({ page }) => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
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
    await page.getByRole('button', { name: 'Start' }).click();
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible({ timeout: 150_000 });

    const people = await page.locator('button[aria-label^="Person"]').count();
    expect(people).toBeGreaterThanOrEqual(1);
    const expectedFile = path.join(dir, 'expected.json');
    if (fs.existsSync(expectedFile)) expect(people).toBe(JSON.parse(fs.readFileSync(expectedFile, 'utf8')).people);

    const hasPreview = await page.locator('canvas').evaluate((c: HTMLCanvasElement) => c.width > 0 && c.height > 0);
    expect(hasPreview).toBe(true);

    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), page.getByRole('button', { name: 'Save' }).click()]);
    const out = fs.readFileSync((await download.path())!);
    expect(out[0]).toBe(0xff);
    expect(out[1]).toBe(0xd8);
    const meta = await exifr.parse(out, { pick: ['DateTimeOriginal', 'ExifImageWidth', 'ExifImageHeight'] });
    const dims = await page.evaluate(async (b64) => {
      const blob = await (await fetch(`data:image/jpeg;base64,${b64}`)).blob();
      const bmp = await createImageBitmap(blob);
      return [bmp.width, bmp.height];
    }, out.toString('base64'));
    expect(dims[0]).toBeGreaterThan(0);
    if (meta?.ExifImageWidth) expect([meta.ExifImageWidth, meta.ExifImageHeight]).toEqual(dims);
    // EXIF DateTimeOriginal is preserved when the source has it
    const srcMeta = await exifr.parse(fs.readFileSync(images[0]), { pick: ['DateTimeOriginal'] });
    if (srcMeta?.DateTimeOriginal) expect(meta?.DateTimeOriginal).toBeTruthy();
  });
}
