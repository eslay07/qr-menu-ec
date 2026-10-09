import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register(new URL('./cloudflare-test-loader.mjs', import.meta.url));
const { default: worker } = await import('../deployment/cloudflare/worker');
const blockedEnv = new Proxy({ MAINTENANCE_MODE: 'true' }, { get(target, key) {
  if (key === 'MAINTENANCE_MODE') return target.MAINTENANCE_MODE;
  throw Error('Maintenance accessed another binding.');
} }) as Parameters<typeof worker.fetch>[1];
const context = { waitUntil() { throw Error('Maintenance scheduled side effect.'); } } as unknown as ExecutionContext;
void test('freeze blocks all hosts, routes, verbs and APK requests before any binding or audit access', async () => {
  for (const host of ['qr-menu-ec.consola.workers.dev','free.consola.workers.dev','menu.example.test'])
    for (const path of ['/owner','/creator','/menu','/api/owner/login','/api/owner/device-session','/api/owner/device-session/refresh','/api/creator/login','/api/creator/recovery','/r/11111111-1111-4111-8111-111111111111/api/v1/session','/api/v1/order/token/cancel','/assets/app.js'])
      for (const method of ['GET','POST','PUT','PATCH','DELETE','OPTIONS','HEAD']) {
        const response = await worker.fetch(new Request(`https://${host}${path}`, { method, headers: { 'User-Agent':'Android WebView' } }), blockedEnv, context);
        assert.equal(response.status,503); assert.equal(response.headers.get('X-QRMenu-Maintenance'),'write-freeze-v1');
        assert.equal(response.headers.get('Cache-Control'),'no-store'); assert.equal(response.headers.get('Set-Cookie'),null);
        assert.equal(response.headers.get('Retry-After'),'60');
      }
});
void test('freeze blocks scheduled writes and preserves cookies; HTML stays readable', async () => {
  await worker.scheduled({} as ScheduledController,blockedEnv);
  const response = await worker.fetch(new Request('https://menu.example.test/menu',{headers:{Accept:'text/html',Cookie:'session=keep-me'}}),blockedEnv,context);
  assert.match(await response.text(),/Mantenimiento temporal/); assert.equal(response.headers.get('Set-Cookie'),null);
});
