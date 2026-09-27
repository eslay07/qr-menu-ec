import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base =
  process.env.PRODUCTION_URL || 'https://qr-menu-ec.consola.workers.dev';
const restaurantUrl =
  process.env.RESTAURANT_URL ||
  'https://la-sazon-marinera.consola.workers.dev/menu';
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mkdir('outputs/experience-qa', { recursive: true });
  await page.goto(`${base}/owner`, { waitUntil: 'networkidle' });
  await page.getByLabel('Correo electrónico').waitFor();
  assert.equal(await page.getByLabel('Código del restaurante').count(), 0);
  await page.screenshot({ path: 'outputs/experience-qa/production-owner.png' });
  const security = await (await page.request.get(`${base}/api/creator/session`)).json();
  assert.equal(typeof security.recoveryEmailReady, 'boolean');
  console.log(`Producción: acceso por correo disponible; envío de recuperación ${security.recoveryEmailReady ? 'configurado' : 'pendiente de proveedor de correo'}.`);
  await page.goto(restaurantUrl, { waitUntil: 'networkidle' });
  await page.locator('.customer').waitFor();
  assert.equal(
    await page.getByLabel('Código del restaurante').count(),
    0,
    'El subdominio mostró el acceso privado en lugar del menú público.',
  );

  await page.goto(`${base}/demo`, { waitUntil: 'networkidle' });
  const banner = await page.locator('.promotion-banner').first().boundingBox();
  assert(banner && banner.height < 422, 'La promoción supera media pantalla.');
  await page.screenshot({ path: 'outputs/experience-qa/production-menu.png' });
  await page
    .getByRole('button', { name: 'Añadir Desayuno continental' })
    .click();
  await page.getByLabel('Café').check();
  await page.getByLabel('Naranja').check();
  await page.getByLabel('Nota para este plato').fill('sin azúcar');
  await page.getByRole('button', { name: 'Añadir configurado' }).click();
  await page.getByRole('button', { name: 'Revisar mi pedido' }).click();
  await page.getByLabel('Nombre o alias').fill('Prueba producción');
  await page.getByRole('button', { name: 'Confirmar pedido' }).click();

  const confirmationHeading = page.getByRole('heading', {
    name: 'Muéstrale este pedido al mesero',
  });
  const botError = page.getByText('No se pudo verificar que seas una persona.');
  await Promise.race([
    confirmationHeading.waitFor(),
    botError.waitFor(),
  ]);
  const blockedByTurnstile = await botError.isVisible();
  if (blockedByTurnstile) {
    console.log(
      'Producción: menú y pedido configurado verificados; Turnstile bloqueó correctamente el navegador automatizado.',
    );
  }
  if (!blockedByTurnstile) {
    await page.getByText('Bebida caliente: Café').waitFor();
    await page.getByText('Jugo: Naranja').waitFor();

    const pdfUrl = await page
      .getByRole('link', { name: 'Abrir PDF' })
      .getAttribute('href');
    assert(pdfUrl, 'La confirmación no incluyó el enlace PDF.');
    const pdf = await page.request.get(new URL(pdfUrl, base).toString());
    assert.equal(pdf.status(), 200);
    assert.match(pdf.headers()['content-type'] || '', /application\/pdf/);

    await page
      .getByRole('button', { name: 'Generar QR para el mesero' })
      .click();
    await page.getByText('El mesero puede escanear este QR').waitFor();
    assert.equal(await page.locator('.order-handoff-qr img').count(), 1);

    console.log(
      'Producción: pedido configurable, confirmación, QR y PDF verificados.',
    );
  }
} finally {
  await browser.close();
}
