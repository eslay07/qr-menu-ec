import { performanceFixture } from './performance-fixture';
import { chromium } from '@playwright/test';
const outputDir = process.env.QA_OUTPUT_DIR || 'outputs/mobile-performance';
import { mkdir, writeFile } from 'node:fs/promises';
import { demoCatalog, defaultSettings } from '../lib/contracts';
const sourceBase = process.env.QA_URL || 'http://127.0.0.1:4181';
if (!/^(localhost|127\.0\.0\.1)$/.test(new URL(sourceBase).hostname)) throw Error('Local fixtures only');
const fixture = await performanceFixture(sourceBase);
const base = fixture.base;
const browser = await chromium.launch();
const results: unknown[] = [];
try {
  for (const mode of ['login', 'remembered-refresh']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, ...(mode === 'remembered-refresh' ? { userAgent: 'Mozilla/5.0 QRMenuEC-Android/0.8.1' } : {}) });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 200000, uploadThroughput: 93750 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    fixture.route('**/api/**', async route => {

      const path = new URL(route.request().url()).pathname;
      if (path === '/api/owner/login') return route.fulfill({ json: route.request().method() === 'POST' ? { ownerUrl: '/' } : { turnstileSiteKey: null } });
      if (path.endsWith('device-session/refresh')) return route.fulfill({ json: { ownerUrl: '/' } });
      if (path.endsWith('device-session')) return route.fulfill({ json: { remembered: true, csrfToken: 'qa-csrf' } });
      if (path.endsWith('/session')) return route.fulfill({ json: { authenticated: true, configured: true, csrfToken: 'qa-csrf', runtime: 'cloud' } });
      if (path.endsWith('/state')) return route.fulfill({ json: { restaurantId: '11111111-1111-4111-8111-111111111111', revision: 1, draft: demoCatalog, settings: defaultSettings, published: null, role: 'owner', features: ['orders', 'promotions'] } });
      return route.fulfill({ json: {} });
    });
    for (let i = 0; i < 20; i++) {
      let start = performance.now();
      await page.goto(base + '/owner');
      if (mode === 'login') {
        await page.getByLabel('Correo electrónico').fill('qa-ficticio@example.invalid');
        await page.getByLabel('Contraseña', { exact: true }).fill('QA-synthetic-password');
        start = performance.now();
        await page.getByRole('button', { name: 'Entrar a mi restaurante' }).click();
      }
      await page.getByRole('button', { name: 'Añadir plato', exact: true }).waitFor();
      results.push({ mode, iteration: i + 1, ms: performance.now() - start });
    }
    await context.close();
  }
  await mkdir(outputDir, { recursive: true });
  await writeFile(`${outputDir}/session-${process.env.QA_PHASE || 'before'}.json`, JSON.stringify({ limitations: ['Mocked credentials/session API with 150 ms controlled RTT; no actual Firebase token or password validation', 'Android userAgent simulates WebView routing only, not physical Android', 'Durations include navigation and automation overhead'], results }, null, 2));
  console.log('40 synthetic login/reopen measurements');
} finally { await browser.close(); await fixture.close(); }
