import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { demoCatalog } from '../lib/contracts';
const base = process.env.QA_URL || 'http://127.0.0.1:4175';
if (!/^(localhost|127\.0\.0\.1)$/.test(new URL(base).hostname)) throw Error('Local synthetic fixtures only');
const browser = await chromium.launch();
const evidence: { template: string; viewportWidth: number; zoom: number; overflow: boolean; scroll: number; width: number }[] = [];
await mkdir('outputs/product-visual-qa', { recursive: true });
try {
  for (const template of ['list', 'cards', 'compact']) for (const width of [320, 360, 390, 768, 1440]) for (const zoom of [1, 2]) {
    const catalog = structuredClone(demoCatalog);
    catalog.name = 'QA FICTICIO · Restaurante';
    catalog.template = template as 'list' | 'cards' | 'compact';
    catalog.promotions = [];
    catalog.dishes = catalog.dishes.map(d => ({ ...d, modifierGroups: [] }));
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    await page.route('**/api/v1/menu', route => route.fulfill({ json: { catalog, ordersEnabled: true, version: 1 } }));
    await page.goto(base + '/menu');
    await page.locator('.dish-card').first().waitFor();
    if (zoom === 2) await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
    await expect(page.getByRole('banner')).toContainText('QA FICTICIO · Restaurante');
    await page.locator('.add-dish').nth(0).click();
    await page.screenshot({ path: `outputs/product-visual-qa/${template}-${width}-zoom${zoom}-first-add.png`, fullPage: false });
    await page.locator('.add-dish').nth(0).click();
    await page.locator('.add-dish').nth(1).click();
    await page.locator('.add-dish').nth(1).click();
    await page.locator('.add-dish').nth(1).click();
    await expect(page.locator('.selection-bar')).toContainText('5 productos');
    const overflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: document.documentElement.clientWidth }));
    await page.screenshot({ path: `outputs/product-visual-qa/${template}-${width}-zoom${zoom}.png`, fullPage: true });
    evidence.push({ template, viewportWidth: width, zoom, overflow: overflow.scroll > overflow.width + 1, ...overflow });
    await page.locator('.selection-bar').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    const dialogFits=await page.getByRole('dialog').evaluate(element=>element.scrollWidth<=element.clientWidth+1);
    expect(dialogFits,'Cart content must reflow inside its dialog').toBe(true);
    const quantityFits=await page.locator('.quantity button').evaluateAll(elements=>elements.every(element=>{const rect=element.getBoundingClientRect();return rect.left>=0&&rect.right<=window.innerWidth+1;}));
    expect(quantityFits,'All quantity controls must fit the viewport').toBe(true);
    await page.screenshot({ path: `outputs/product-visual-qa/${template}-${width}-zoom${zoom}-cart.png`, fullPage: false });
    await page.close();
  }
  await writeFile('outputs/product-visual-qa/evidence.json', JSON.stringify({ limitation: 'CSS zoom 200% in Chromium; local mocked publication; not physical phone or browser UI zoom', evidence }, null, 2));
  if (evidence.some(x => x.overflow)) throw Error('Horizontal overflow found; inspect evidence and screenshots');
  console.log('30 public menu/cart viewport+zoom combinations passed');
} finally { await browser.close(); }
