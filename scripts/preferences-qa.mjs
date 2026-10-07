import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

// Isolated UI fixture: real component, mocked API. No production requests.
const server = await createServer({ configFile: false, plugins: [react(), {
  name: 'preferences-qa', configureServer(server) {
    server.middlewares.use('/__preferences', async (req, res, next) => {
      if (req.url?.includes('html-proxy')) return next();
      const html = '<div id="root"></div><script type="module">import RefreshRuntime from "/@react-refresh"; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true; await import("/tests/preferences-browser-entry.tsx");</script>';
      res.setHeader('Content-Type', 'text/html'); res.end(html);
    });
  },
}], optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client'] }, server: { watch: null, host: '127.0.0.1', port: 4193, strictPort: true } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch();
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(20000);
  let revision = 'v1', fail = false;
  let settings = { newOrder: true, customerCancelled: true, soldOut: true, dailySummary: false, inactivity: false, inactivityHours: 8 };
  let wifi = { enabled: false, name: '', hasPassword: false };
  await page.route('**/api/v1/settings/*', async route => {
    const isWifi = route.request().url().endsWith('/wifi');
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON();
      expect(body.revision).toBe(revision);
      if (fail) return route.fulfill({ status: 409, json: { error: 'Otra sesión modificó las preferencias. Conservamos tus cambios.' } });
      if (isWifi) {
        expect(body.settings.password).toBe('clave-qa');
        wifi = { enabled: body.settings.enabled, name: body.settings.name, hasPassword: true };
      } else settings = body.settings;
      revision = 'v2';
    }
    await route.fulfill({ json: isWifi ? { revision, ...wifi } : { revision, settings } });
  });
  await page.goto('http://127.0.0.1:4193/__preferences?mode=notifications');
  await expect(page.getByRole('checkbox')).toHaveCount(5);
  await page.getByLabel('Resumen diario de ventas').check();
  await page.getByLabel('Sin pedidos durante varias horas').check();
  await page.getByLabel('Horas sin pedidos').fill('6');
  await page.getByRole('button', { name: 'Guardar preferencias' }).click();
  await expect(page.getByRole('status')).toHaveText('Guardado ✓');
  await page.reload();
  await expect(page.getByLabel('Horas sin pedidos')).toHaveValue('6');
  await expect(page.getByLabel('Resumen diario de ventas')).toBeChecked();
  await page.goto('http://127.0.0.1:4193/__preferences?mode=wifi');
  await page.getByLabel('Mostrar WiFi en la impresión').check();
  await page.getByLabel('Nombre de la red').fill('Invitados');
  await page.getByLabel('Clave del WiFi').fill('clave-qa');
  fail = true;
  await page.getByRole('button', { name: 'Guardar preferencias' }).click();
  await expect(page.getByRole('alert')).toBeFocused();
  await expect(page.getByLabel('Clave del WiFi')).toHaveValue('clave-qa');
  fail = false;
  await page.getByRole('button', { name: 'Guardar preferencias' }).click();
  await expect(page.getByRole('status')).toHaveText('Guardado ✓');
  await expect(page.getByLabel('Clave del WiFi')).toHaveValue('');
  await page.reload();
  await expect(page.getByLabel('Nombre de la red')).toHaveValue('Invitados');
  await expect(page.getByLabel('Clave del WiFi')).toHaveValue('');
  console.log('Preferencias: cinco avisos, persistencia UI, WiFi, conflicto y limpieza de clave aprobados (API simulada).');
} finally { await browser?.close(); await server.close(); }
