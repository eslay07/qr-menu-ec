import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { demoCatalog, defaultSettings } from '../lib/contracts';

const base = process.env.QA_URL || 'http://127.0.0.1:4175';
if (!new URL(base).hostname.match(/^(127\.0\.0\.1|localhost)$/)) throw Error('Use only a local preview for mocked UI tests.');
const browser = await chromium.launch();
await mkdir('outputs/experience-qa', { recursive: true });
const catalog = structuredClone(demoCatalog);
catalog.promotions.push({ ...catalog.promotions[0], id: 'second-offer', dishId: catalog.dishes[1].id, title: 'El favorito de la casa', promotionalPriceCents: null });
try {
  for (const width of [360, 390, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    await page.route('**/api/v1/menu', route => route.fulfill({ json: { catalog, ordersEnabled: true } }));
    await page.goto(`${base}/menu`);
    await page.locator('.promotion-banner').first().waitFor({ timeout: 30_000 });
    await expect(page.locator('.promotion-banner')).toHaveCount(2);
    const banner = await page.locator('.promotion-banner').first().boundingBox();
    assert(banner && banner.height < 844 / 2);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Horizontal page overflow');
    await page.getByRole('button', { name: 'Siguiente promoción' }).click();
    await expect(page.locator('.offers-controls span')).toHaveText('2 / 2');
    await page.getByRole('button', { name: 'Promoción anterior' }).click();
    await expect(page.locator('.offers-controls span')).toHaveText('1 / 2');
    await page.locator('.offer-action').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `outputs/experience-qa/menu-${width}.png`, fullPage: false });
    await page.close();
  }
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await page.route('**/api/v1/menu', route => route.fulfill({ json: { catalog } }));
  await page.goto(`${base}/menu`);
  await page.locator('.promotion-banner').first().waitFor({ timeout: 30_000 });
  await expect(page.locator('.promotion-banner').first()).toHaveCSS('animation-name', 'none');
  const id = '11111111-1111-4111-8111-111111111111';
  let draft = structuredClone(demoCatalog);
  let saved = false;
  let uploaded = false;
  let failUpload = false;
  let failSave = true;
  let loggedIn = true;
  const image = await readFile('public/demo/encebollado.jpg');
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/session')) return route.fulfill({ json: { authenticated: loggedIn, configured: true, runtime: 'cloud', csrfToken: 'test-csrf' } });
    if (url.pathname.endsWith('/state')) return route.fulfill({ json: { restaurantId: id, revision: 1, draft, settings: defaultSettings, published: null, role: 'owner', features: ['orders', 'promotions'] } });
    if (url.pathname.endsWith('/media') && route.request().method() === 'POST') {
      if (failUpload) return route.fulfill({ status: 503, json: { error: 'No se pudo subir la foto. Intenta de nuevo.' } });
      const data = route.request().postDataBuffer()!;
      assert(data.length <= 1_000_000); assert.equal(data[0], 0xff); assert.equal(data[1], 0xd8);
      assert.equal(route.request().headers()['x-csrf-token'], 'test-csrf');
      uploaded = true;
      return route.fulfill({ json: { url: `/r/${id}/api/v1/media/test-photo` } });
    }
    if (url.pathname.endsWith('/media/test-photo')) return route.fulfill({ body: image, contentType: 'image/jpeg' });
    if (url.pathname.endsWith('/draft')) {
      if (failSave) return route.fulfill({ status: 409, json: { error: 'Hay una actualización más reciente. Revisa los cambios antes de guardar.' } });
      draft = route.request().postDataJSON().catalog; saved = true; return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: {} });
  });
  // The production Worker rewrites /r/<id>/ to the SPA root. Vinext's local
  // dev server has no dynamic /r route, so exercise the same Dashboard at /.
  await page.goto(`${base}/`);
  await page.getByRole('button', { name: 'Añadir plato', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre', { exact: true }).fill('Plato con foto');
  await dialog.getByLabel('Precio en USD').fill('5');
  const picker = dialog.getByLabel('Subir foto del plato');
  await picker.setInputFiles({ name: 'dish.jpg', mimeType: 'image/jpeg', buffer: image });
  await expect(dialog.getByAltText('Vista previa de la foto del plato')).toBeVisible();
  assert(uploaded);
  failUpload = true;
  await picker.setInputFiles({ name: 'retry.jpg', mimeType: 'image/jpeg', buffer: image });
  await expect(dialog.getByRole('alert')).toContainText('No se pudo subir');
  await expect(dialog.getByLabel('Nombre', { exact: true })).toHaveValue('Plato con foto');
  await expect(dialog.getByAltText('Vista previa de la foto del plato')).toBeVisible();
  await page.screenshot({ path: 'outputs/experience-qa/photo-editor.png' });
  await dialog.getByRole('button', { name: 'Guardar plato', exact: true }).click();
  await expect(page.locator('.feedback-toast')).toContainText('actualización más reciente');
  await expect(dialog.getByLabel('Nombre', { exact: true })).toHaveValue('Plato con foto');
  await expect(dialog.getByAltText('Vista previa de la foto del plato')).toBeVisible();
  failSave = false;
  await dialog.getByRole('button', { name: 'Guardar plato', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  assert(saved && draft.dishes.some(d => d.name === 'Plato con foto' && d.image.includes('test-photo')));
  await page.getByRole('button', { name: 'Editar Plato con foto', exact: true }).click();
  await expect(dialog.getByAltText('Vista previa de la foto del plato')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.screenshot({ path: 'outputs/experience-qa/owner-carta.png' });
  await page.route('**/api/owner/login', route => route.fulfill({ json: { turnstileSiteKey: null } }));
  loggedIn = false;
  await page.goto(`${base}/`);
  await expect(page.getByLabel('Correo electrónico')).toBeVisible();
  await expect(page.getByLabel('Código del restaurante')).toHaveCount(0);
  await page.screenshot({ path: 'outputs/experience-qa/owner-login.png' });
  console.log('QA: 4 screen sizes, compact carousel, keyboard closing, reduced motion, image upload/error/reopen/save and email login passed.');
} finally { await browser.close(); }
