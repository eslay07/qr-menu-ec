import { chromium, expect } from '@playwright/test';
import { preview } from 'vite';
import { existsSync } from 'node:fs';

if (!existsSync('dist-worker/firebase-messaging-sw.js')) throw Error('Build the local push-enabled variant first; this test never enables production.');
const server = await preview({ configFile: 'vite.worker.config.ts', preview: { host: '127.0.0.1', port: 4191, strictPort: true, open: false } });
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ permissions: ['notifications'] });
  context.on('console', message => { if (message.type() === 'error') console.error('Browser error:', message.text()); });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4191/demo');
  const rid = '998d4980-a169-469f-b009-634a373ca7ad';
  await page.evaluate(async restaurantId => {
    await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });
    const registration = await navigator.serviceWorker.ready;
    registration.active.postMessage({ type: 'push-preference', restaurantId });
  }, rid);
  await expect.poll(() => page.evaluate(async () => (await (await caches.open('qrmenu-push-preference')).match('/__qrmenu_push_preference__'))?.text())).toBe(rid);
  const worker = context.serviceWorkers()[0];
  // Windows headless Chromium may leave showNotification pending without an OS
  // notification center. Test the real worker logic with an explicit display
  // adapter, not a claim of physical receipt or a Firebase delivery test.
  await worker.evaluate(() => {
    self.__shown = [];
    self.registration.showNotification = async (title, options) => { self.__shown.push({ title, ...options }); };
  });
  await page.evaluate(async restaurantId => {
    const registration = await navigator.serviceWorker.ready;
    const channel = new MessageChannel();
    const handled = new Promise(resolve => { channel.port1.onmessage = resolve; });
    registration.active.postMessage({ type: 'foreground-push', data: { eventId: 'local-test', restaurantId, title: 'UNTRUSTED', body: 'PII SHOULD NOT APPEAR' } }, [channel.port2]);
    await handled;
    channel.port1.close();
  }, rid);
  await expect.poll(() => worker.evaluate(() => self.__shown.length)).toBe(1);
  const notification = await worker.evaluate(() => self.__shown[0]);
  expect(notification.title).toBe('QR Menu EC');
  expect(notification.body).not.toContain('PII');
  expect(notification.tag).toBe(`qrmenu-${rid}-local-test`);
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    registration.active.postMessage({ type: 'push-preference', restaurantId: null });
  });
  await expect.poll(() => page.evaluate(async () => !!(await (await caches.open('qrmenu-push-preference')).match('/__qrmenu_push_preference__')))).toBe(false);
  await page.evaluate(async restaurantId => {
    const registration = await navigator.serviceWorker.ready;
    const channel = new MessageChannel();
    const handled = new Promise(resolve => { channel.port1.onmessage = resolve; });
    registration.active.postMessage({ type: 'foreground-push', data: { eventId: 'after-disable', restaurantId } }, [channel.port2]);
    await handled;
    channel.port1.close();
  }, rid);
  // An explicit acknowledgement confirms the suppressed event was processed.
  expect(await worker.evaluate(() => self.__shown.length)).toBe(1);
  await context.close();
  console.log('Service worker local: contenido genérico, etiqueta estable y baja verificados con adaptador de visualización simulado. No se envió un push real ni se verificó la notificación del sistema operativo.');
} finally { await browser?.close(); await new Promise(resolve => server.httpServer.close(resolve)); }
