import { chromium, expect } from '@playwright/test';
import { preview } from 'vite';
import { resolve } from 'node:path';
import { blankCatalog, defaultSettings } from '../lib/contracts';

const isolated = resolve('work/session-ui-hotfix/source');
const server = await preview({ configFile: resolve(isolated, 'vite.worker.config.ts'), root: resolve(isolated, 'worker-ui'), build: { outDir: resolve(isolated, 'dist-worker') }, preview: { host: '127.0.0.1', port: 4194, strictPort: true } });
const browser = await chromium.launch();
try {
  for (const failState of [false, true]) {
    const page = await browser.newPage({ userAgent: 'Mozilla/5.0 QRMenuEC-Android/0.8.0' });
    let renewals = 0, stateReads = 0;
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.includes('/device-session') || path === '/api/owner/login') {
        renewals++;
        return route.fulfill({ json: { remembered: false, turnstileSiteKey: null } });
      }
      if (path.endsWith('/session')) return route.fulfill({ json: { configured: true, authenticated: true, runtime: 'cloud', csrfToken: 'test' } });
      if (path.endsWith('/state')) {
        stateReads++;
        await new Promise(resolve => setTimeout(resolve, 1200));
        return route.fulfill(failState ? { status: 503, json: { error: 'Carga temporalmente no disponible' } } : { json: { revision: 1, draft: blankCatalog, settings: defaultSettings, features: [], role: 'owner', maxDishes: 150, sampleMenuEnabled: false, access: { active: true }, published: null, license: null } });
      }
      return route.fulfill({ json: {} });
    });
    await page.goto('http://127.0.0.1:4194/r/11111111-1111-4111-8111-111111111111/?remembered=1');
    await expect.poll(() => stateReads).toBe(1);
    await page.waitForTimeout(1700);
    expect(renewals, 'Authenticated loading must never mount the login/renewal form').toBe(0);
    if (failState) {
      await expect(page.getByRole('heading', { name: 'No se pudo cargar tu restaurante' })).toBeVisible();
      await page.getByRole('button', { name: 'Reintentar' }).click();
      await expect.poll(() => stateReads).toBe(2);
      expect(renewals).toBe(0);
    } else await expect(page.getByRole('button', { name: 'Carta', exact: true })).toBeVisible();
    await page.close();
  }
  console.log('Sesión: carga lenta y error/reintento no montan login ni renuevan en bucle.');
} finally { await browser.close(); await new Promise<void>(resolve => server.httpServer.close(() => resolve())); }
