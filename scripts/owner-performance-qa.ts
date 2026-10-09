import { chromium, expect } from '@playwright/test';
const outputDir = process.env.QA_OUTPUT_DIR || 'outputs/mobile-performance';
import { mkdir, writeFile } from 'node:fs/promises';
import { demoCatalog, defaultSettings } from '../lib/contracts';
const base = process.env.QA_URL || 'http://127.0.0.1:4181';
if (!/^(localhost|127\.0\.0\.1)$/.test(new URL(base).hostname)) throw Error('Local fixtures only');
const browser = await chromium.launch();
const results: unknown[] = [];
try {
  for (const size of [10, 40]) {
    let draft = structuredClone(demoCatalog);
    draft.name = 'QA FICTICIO Laboratorio';
    draft.nameConfirmed = true;
    draft.promotions = [];
    draft.dishes = Array.from({ length: size }, (_, i) => ({ ...draft.dishes[0], id: `qa-${i}`, name: `Plato ficticio ${i}`, modifierGroups: [] }));
    let revision = 1;
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 200000, uploadThroughput: 93750 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      // Explicit controlled API RTT; this is synthetic, not backend timing.
      await new Promise(resolve => setTimeout(resolve, 150));
      if (path.endsWith('/session')) return route.fulfill({ json: { authenticated: true, configured: true, runtime: 'cloud', csrfToken: 'qa-csrf' } });
      if (path.endsWith('/state')) return route.fulfill({ json: { restaurantId: '11111111-1111-4111-8111-111111111111', revision, draft, settings: defaultSettings, published: { version: 1, catalog: draft }, role: 'owner', features: ['orders', 'promotions'], entitlements: { reports: true }, maxDishes: 40 } });
      if (path.endsWith('/draft')) { draft = route.request().postDataJSON().catalog; revision++; return route.fulfill({ json: { ok: true, revision } }); }
      if (path.endsWith('/publish')) { revision++; return route.fulfill({ json: { ok: true, revision } }); }
      if (path.endsWith('/menu')) return route.fulfill({ json: { catalog: draft, ordersEnabled: true } });
      if (path.includes('/reports/orders')) return route.fulfill({ json: { orders: [], totalCents: 0, totalOrders: 0 } });
      return route.fulfill({ json: {} });
    });
    for (const temperature of ['cold', 'warm']) for (let i = 0; i < 5; i++) {
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: temperature === 'cold' });
      if (temperature === 'cold') await cdp.send('Network.clearBrowserCache');
      const start = performance.now();
      await page.goto(base + '/');
      await page.getByRole('button', { name: 'Añadir plato', exact: true }).waitFor();
      results.push({ size, temperature, iteration: i + 1, interaction: 'panel-open', ms: performance.now() - start });
    }
    for (let i = 0; i < 20; i++) {
      await page.locator('.availability').first().click();
      let start = performance.now();
      await page.getByRole('button', { name: 'Guardar borrador', exact: true }).click();
      await expect(page.locator('.feedback-toast')).toContainText('Borrador guardado');
      results.push({ size, interaction: 'save', iteration: i + 1, ms: performance.now() - start });
      start = performance.now();
      await page.getByRole('button', { name: 'Publicar menú', exact: true }).click();
      await expect(page.locator('.feedback-toast')).toContainText('Menú publicado');
      results.push({ size, interaction: 'publish', iteration: i + 1, ms: performance.now() - start });
      start = performance.now();
      await page.getByRole('button', { name: 'Pedidos', exact: true }).click();
      await page.waitForTimeout(200);
      results.push({ size, interaction: 'orders-open', iteration: i + 1, ms: performance.now() - start });
      await page.getByRole('button', { name: 'Carta', exact: true }).click();
    }
    await context.close();
  }
  await mkdir(outputDir, { recursive: true });
  await writeFile(`${outputDir}/owner-${process.env.QA_PHASE || 'before'}.json`, JSON.stringify({ profile: { width: 390, cpu: 4, downloadMbps: 1.6, uploadKbps: 750, rttMs: 150 }, limitations: ['Mocked authenticated session and API: no real Firebase login/refresh', 'API fixture adds controlled 150 ms per response; not server benchmark', 'Interaction includes browser automation overhead', 'Orders open includes 200 ms fixed settle, not valid latency target'], results }, null, 2));
  console.log(`Owner performance: ${results.length} measurements`);
} finally { await browser.close(); }
