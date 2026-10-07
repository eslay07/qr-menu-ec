import { chromium, expect } from '@playwright/test';
import { preview } from 'vite';
import {readFile} from 'node:fs/promises';

// Own the preview lifecycle so a prior terminal session is not a prerequisite.
const candidate = process.env.QR_QA_CANDIDATE_ORIGIN;
const receipt=JSON.parse(await readFile('work/d1-production-candidate/version.json','utf8'));
const currentD1Candidate = candidate === `https://${receipt.versionId.slice(0,8)}-qr-menu-ec.consola.workers.dev` || candidate === 'https://59cf7bb8-qr-menu-ec.consola.workers.dev';
if (candidate && !currentD1Candidate && !['https://22052178-qr-menu-ec.consola.workers.dev','https://b5cc3b53-qr-menu-ec.consola.workers.dev','https://f98783e0-qr-menu-ec.consola.workers.dev','https://fcea08f9-qr-menu-ec.consola.workers.dev','https://724862e7-qr-menu-ec.consola.workers.dev','https://c0aebaa8-qr-menu-ec.consola.workers.dev','https://a64e07c2-qr-menu-ec.consola.workers.dev'].includes(candidate)) throw Error('Unexpected candidate origin');
const server = candidate ? null : await preview({ configFile: 'vite.worker.config.ts', preview: { host: '127.0.0.1', port: 4190, strictPort: true, open: false } });
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 700 }, reducedMotion });
    if (candidate) await page.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      // Validation must finish locally, never create an order or follow a production alias.
      if (url.hostname.endsWith('.workers.dev') && (url.origin !== candidate || !['GET','HEAD'].includes(request.method()))) return route.abort();
      return route.continue();
    });
    await page.goto(`${candidate || 'http://127.0.0.1:4190'}/demo`);
    await page.getByRole('button', { name: 'Ver mi pedido' }).click();
    await page.getByRole('button', { name: 'Confirmar pedido', exact: true }).click();
    await expect(page.locator('#order-error')).toBeFocused();
    await expect(page.locator('#order-error')).toBeInViewport();
    await page.getByRole('button', { name: 'Volver al menú' }).click();
    await page.getByRole('button', { name: 'Añadir Desayuno continental', exact: true }).click();
    await page.getByRole('button', { name: 'Añadir configurado' }).click();
    await expect(page.locator('.configurator [aria-invalid="true"]').first()).toBeFocused();
    await expect(page.locator('.configurator [aria-invalid="true"]').first()).toBeInViewport();
    // A repeat click must reveal the same error, not depend on text changing.
    await page.getByRole('button', { name: 'Añadir configurado' }).click();
    await expect(page.locator('.configurator [aria-invalid="true"]').first()).toBeFocused();
    await expect(page.locator('.configurator [aria-invalid="true"]').first()).toHaveCSS('border-top-color', 'rgb(180, 35, 24)');
    while (await page.locator('.configurator [aria-invalid="true"]').count()) {
      await page.locator('.configurator [aria-invalid="true"]').first().locator('input:not(:disabled)').first().check();
    }
    await page.getByRole('button', { name: 'Añadir configurado' }).click();
    await page.getByRole('button', { name: 'Ver mi pedido' }).click();
    await page.getByRole('button', { name: 'Confirmar pedido', exact: true }).click();
    await expect(page.locator('#order-alias')).toBeFocused();
    await expect(page.locator('#order-alias')).toBeInViewport();
    await expect(page.locator('#order-alias')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#order-error')).toContainText('nombre o alias');
    await page.close();
  }
  console.log(`Pedido móvil: errores visibles, foco, repetición y movimiento reducido verificados. Origen: ${candidate || 'local'}`);
} finally {
  await browser?.close();
  if (server) await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
}
