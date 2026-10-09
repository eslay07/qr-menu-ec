import { performanceFixture } from './performance-fixture';
import { chromium } from '@playwright/test';
const outputDir = process.env.QA_OUTPUT_DIR || 'outputs/mobile-performance';
import { mkdir, writeFile } from 'node:fs/promises';
import { demoCatalog } from '../lib/contracts';
declare global { interface Window { __qa: { lcp: number; cls: number; usableMs: number } } }

const sourceBase = process.env.QA_URL || 'http://127.0.0.1:4175';
if (!/^(localhost|127\.0\.0\.1)$/.test(new URL(sourceBase).hostname)) throw Error('Synthetic fixtures require local preview');
const fixture = await performanceFixture(sourceBase);
const base = fixture.base;
const label = process.env.QA_PHASE || 'before';
const browser = await chromium.launch();
const results: unknown[] = [];
try {
  for (const size of [10, 40]) {
    const catalog = structuredClone(demoCatalog);
    catalog.name = 'QA FICTICIO · laboratorio';
    catalog.promotions = [];
    catalog.dishes = Array.from({ length: size }, (_, i) => ({ ...catalog.dishes[0], id: `qa-${i}`, name: `Plato ficticio ${i}`, categoryId: catalog.categories[i % catalog.categories.length].id, modifierGroups: [] }));
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    fixture.route('**/api/v1/menu', route => route.fulfill({ json: { catalog, ordersEnabled: true, version: 1 } }));
    await page.addInitScript(() => {
      window.__qa = { lcp: 0, cls: 0, usableMs: 0 };
      new MutationObserver(() => {
        if (window.__qa.usableMs !== 0 || !document.querySelector('.dish-card .add-dish:not(:disabled)') || !document.querySelector('input[aria-label="Buscar platos"]')) return;
        window.__qa.usableMs = -1;
        requestAnimationFrame(() => requestAnimationFrame(() => { window.__qa.usableMs = performance.now(); }));
      }).observe(document, {childList:true,subtree:true});
      new PerformanceObserver(list => { for (const e of list.getEntries()) window.__qa.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver(list => { for (const entry of list.getEntries()) { const e = entry as PerformanceEntry & { hadRecentInput: boolean; value: number }; if (!e.hadRecentInput) window.__qa.cls += e.value; } }).observe({ type: 'layout-shift', buffered: true });
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1600000 / 8, uploadThroughput: 750000 / 8 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    for (const temperature of ['cold', 'warm']) {
      let excluded = 0;
      for (let i = 0; i < 5; i++) {
        await cdp.send('Network.setCacheDisabled', { cacheDisabled: temperature === 'cold' });
        if (temperature === 'cold') await cdp.send('Network.clearBrowserCache');
        const start = performance.now();
        await page.goto(`${base}/menu`, { waitUntil: 'networkidle' });
        await page.locator('.dish-card').first().waitFor();
        await page.waitForTimeout(100);
        const observed = await page.evaluate(() => window.__qa);
        if (!observed.lcp) {
          if (++excluded > 5) throw Error('LCP observer repeatedly returned no entry');
          console.log(`Excluded LCP with no event: ${size}/${temperature}/${excluded}`);
          i--; continue;
        }
        const cachedStaticResources = await page.evaluate(() => performance.getEntriesByType('resource').filter(e => {const resource=e as PerformanceResourceTiming;return resource.name.includes('/assets/') && resource.encodedBodySize>0 && resource.transferSize===0;}).length);
        if (temperature === 'warm' && cachedStaticResources === 0) throw Error('Warm run has no verified cached static resource');
        if (observed.usableMs <= 0) throw Error('Interactive menu readiness was not observed');
        results.push({ size, temperature, iteration: i + 1, automationSettledMs: performance.now() - start, ...observed, cachedStaticResources, transfer: await page.evaluate(() => performance.getEntriesByType('resource').reduce((sum, e) => sum + (e as PerformanceResourceTiming).transferSize, 0)) });
      }
    }
    for (let i = 0; i < 20; i++) {
      const searchStart = performance.now();
      await page.getByRole('textbox', { name: 'Buscar platos' }).fill('ficticio 0');
      await page.waitForFunction(() => document.querySelectorAll('.dish-card').length === 1);
      results.push({ size, interaction: 'search', iteration: i + 1, ms: performance.now() - searchStart });
      await page.getByRole('textbox', { name: 'Buscar platos' }).fill('');
      const categoryStart = performance.now();
      await page.locator('.category-tabs button').nth(1).click();
      await page.locator('.category-tabs button.selected').nth(0).waitFor();
      results.push({ size, interaction: 'category', iteration: i + 1, ms: performance.now() - categoryStart });
      await page.getByRole('button', { name: 'Todo el menú', exact: true }).click();
      const cartStart = performance.now();
      await page.locator('.add-dish').first().click();
      await page.locator('.selection-bar').waitFor();
      results.push({ size, interaction: 'cart-add', iteration: i + 1, ms: performance.now() - cartStart });
    }
    await context.close();
  }
  await mkdir(outputDir, { recursive: true });
  await writeFile(`${outputDir}/${label}.json`, JSON.stringify({ recordedAt: new Date().toISOString(), profile: { width: 390, cpu: 4, downloadMbps: 1.6, uploadKbps: 750, latencyMs: 150 }, limitations: ['Local built SPA with mocked public API; API endpoint does not measure real server latency', 'Browser automation duration includes locator/action overhead', 'usableMs observes enabled search/cart plus two animation frames; automationSettledMs separately includes networkidle and controller waits', 'No physical Android device measurement'], results }, null, 2));
  console.log(`${label}: ${results.length} measurements saved`);
} finally { await browser.close(); await fixture.close(); }
