import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import sharp from 'sharp';

const base = process.env.PAGES_URL || 'http://127.0.0.1:4173';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${base}/restaurante-demo`, { waitUntil: 'networkidle' });
  await page.getByText('Desayuno continental').waitFor();
  await page.goto(`${base}/restaurante-demo/qr`, { waitUntil: 'networkidle' });
  const source = await page.locator('.print-card img').getAttribute('src');
  assert(source?.startsWith('data:image/png;base64,'));
  const buffer = Buffer.from(source.split(',')[1], 'base64');
  const image = await sharp(buffer)
    .raw()
    .ensureAlpha()
    .toBuffer({ resolveWithObject: true });
  const decoded = jsQR(
    new Uint8ClampedArray(image.data),
    image.info.width,
    image.info.height,
  );
  assert.equal(decoded?.data, 'https://qr-menu-ec.pages.dev/restaurante-demo');
  assert.equal(await page.locator('.print-card').count(), 1);
  console.log('Pages QA: carta configurable y único QR HTTPS verificados.');
} finally {
  await browser.close();
}
