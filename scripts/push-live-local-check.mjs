import { chromium } from '@playwright/test';
import { createServer, loadEnv } from 'vite';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

// Disposable local browser only. Never print registration tokens or credentials.
const require = createRequire(import.meta.url);
const project = 'qr-menu-6981a';
const env = loadEnv('development', process.cwd(), 'VITE_');
if (!env.VITE_FIREBASE_VAPID_KEY) throw Error('Missing public VAPID configuration');
const server = await createServer({ configFile: 'vite.worker.config.ts', server: { host: '127.0.0.1', port: 4192, strictPort: true, open: false }, plugins: [{ name: 'local-push-test-worker', configureServer(viteServer) { viteServer.middlewares.use(async (req, res, next) => {
  if (req.url !== '/firebase-messaging-sw.js') return next();
  res.setHeader('Content-Type', 'application/javascript');
  res.end(await readFile('dist-worker/firebase-messaging-sw.js'));
}); } }] });
let browser, page;
let stage = 'local-server';
try {
  await server.listen();
  // Installed Chrome with a disposable profile; background networking is needed
  // for its push service. No personal profile or saved user session is opened.
  browser = await chromium.launch({ channel: 'chrome', headless: !process.argv.includes('--interactive'), ignoreDefaultArgs: ['--disable-background-networking'] });
  const context = await browser.newContext({ permissions: ['notifications'] });
  await context.grantPermissions(['notifications'], { origin: 'http://127.0.0.1:4192' });
  page = await context.newPage();
  await page.goto('http://127.0.0.1:4192/demo');
  console.log(JSON.stringify(await page.evaluate(() => ({ secureContext: isSecureContext, notificationPermission: Notification.permission }))));
  const moduleUrl = `/@fs/${resolve('tests/push-browser-entry.ts').replaceAll('\\', '/')}`;
  stage = 'browser-registration';
  const outcome = await page.evaluate(async ({ moduleUrl, vapidKey }) => {
    const sdk = await import(moduleUrl);
    const { messaging } = sdk;
    const instance = await messaging;
    if (!instance) return { supported: false };
    window.__pushTest = { instance, sdk };
    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => setTimeout(() => reject(Error('WORKER_TIMEOUT')), 15000))]);
    try {
      const token = await Promise.race([sdk.getToken(instance, { vapidKey, serviceWorkerRegistration: registration }), new Promise((_, reject) => setTimeout(() => reject(Error('REGISTRATION_TIMEOUT')), 30000))]);
      window.__pushReceived = new Promise(resolve => sdk.onMessage(instance, payload => resolve(payload.data?.eventId)));
      return { supported: true, token };
    } catch (error) { return { supported: true, code: error.code || (error.message === 'REGISTRATION_TIMEOUT' ? error.message : 'REGISTRATION_FAILED'), diagnostic: String(error.message || '').replace(/https?:\/\/[^\s]+/g, '[url]').replace(/[A-Za-z0-9_:-]{35,}/g, '[redacted]').slice(0, 250) }; }
  }, { moduleUrl, vapidKey: env.VITE_FIREBASE_VAPID_KEY });
  if (!outcome.token) {
    console.log(JSON.stringify({ registered: false, supported: outcome.supported, reason: outcome.code || 'UNSUPPORTED', diagnostic: outcome.diagnostic, productionChanged: false }));
    process.exitCode = 2; // Inconclusive environment check, never a passing receipt test.
  } else {
    stage = 'send-test-message';
    const auth = require('firebase-tools/lib/auth');
    await require('firebase-tools/lib/requireAuth').requireAuth({ project, nonInteractive: true, ...auth.getProjectDefaultAccount(process.cwd()) });
    const { Client } = require('firebase-tools/lib/apiv2');
    const eventId = crypto.randomUUID();
    const result = await new Client({ urlPrefix: 'https://fcm.googleapis.com', apiVersion: 'v1' }).post(`projects/${project}/messages:send`, { message: { token: outcome.token, data: { eventId, title: 'Prueba local QR Menu EC' }, webpush: { headers: { TTL: '30' } } } }, { skipLog: { reqBody: true, resBody: true }, resolveOnHTTPError: true });
    const received = result.status === 200 && await page.evaluate(async expected => Promise.race([window.__pushReceived.then(id => id === expected), new Promise(resolve => setTimeout(() => resolve(false), 30000))]), eventId);
    console.log(JSON.stringify({ registered: true, sendStatus: result.status, received, productionChanged: false }));
    if (!received) process.exitCode = 2;
  }
} catch (error) {
  console.error(JSON.stringify({ stage, errorType: error?.name || 'Error', diagnostic: String(error?.message || '').replace(/https?:\/\/[^\s]+/g, '[url]').replace(/[A-Za-z0-9_:-]{35,}/g, '[redacted]').slice(0, 500), completed: false, productionChanged: false }));
  process.exitCode = 1;
} finally {
  // Cleanup runs even when sending fails. Never touches another subscription.
  const revoked = page && !page.isClosed() ? await page.evaluate(async () => {
    if (!window.__pushTest) return true;
    const { sdk, instance } = window.__pushTest;
    return Promise.race([sdk.deleteToken(instance).then(() => true).catch(() => false), new Promise(resolve => setTimeout(() => resolve(false), 10000))]);
  }).catch(() => false) : null;
  console.log(JSON.stringify({ disposableTokenRevoked: revoked }));
  await browser?.close(); await server.close();
}
