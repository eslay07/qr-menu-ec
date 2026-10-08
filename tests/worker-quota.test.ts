import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { FirestoreError } from '../lib/firestore-rest';
register(new URL('./cloudflare-test-loader.mjs', import.meta.url));
const { default: worker } = await import('../deployment/cloudflare/worker');
const context = { waitUntil(promise: Promise<unknown>) { void promise.catch(() => undefined); } } as ExecutionContext;
test('login shells and APK downloads remain available without database access', async () => {
  const env = { DB: { prepare() { throw Error('Static routes must not query DB'); } }, ASSETS: { fetch: async () => new Response('asset') } } as unknown as Parameters<typeof worker.fetch>[1];
  for (const path of ['/owner', '/creator', '/demo', '/downloads/qr-menu-ec.apk', '/assets/app.js', '/firebase-messaging-sw.js']) {
    const response = await worker.fetch(new Request(`https://qr-menu-ec.consola.workers.dev${path}`), env, context);
    assert.equal(response.status, 200); assert.equal(await response.text(), 'asset');
  }
});
test('quota errors produce a safe retryable 503, never an unhandled 500 or secret', async () => {
  const env = { DB: { prepare() { throw new FirestoreError(429, 'RESOURCE_EXHAUSTED'); } }, ASSETS: { fetch: async () => new Response('asset') } } as unknown as Parameters<typeof worker.fetch>[1];
  const response = await worker.fetch(new Request('https://qr-menu-ec.consola.workers.dev/r/11111111-1111-4111-8111-111111111111/api/v1/session'), env, context);
  assert.equal(response.status, 503); assert.equal(response.headers.get('Retry-After'), '60');
  const body = await response.text(); assert.match(body, /temporalmente limitado/);
  assert.doesNotMatch(body, /RESOURCE_EXHAUSTED|Firestore|private_key/);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

void test('Android update metadata is fresh and available without private database queries', async () => {
 const data=JSON.stringify({versionCode:15});
 const env={DB:{prepare(){throw Error('Update metadata must not query DB');}},ASSETS:{fetch:async()=>new Response(data,{headers:{'Content-Type':'application/json','Cache-Control':'public,max-age=86400'}})}} as unknown as Parameters<typeof worker.fetch>[1];
 for(const method of ['GET','HEAD']){const response=await worker.fetch(new Request('https://qr-menu-ec.consola.workers.dev/downloads/android-release.json',{method}),env,context);assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('Content-Type'),'application/json');assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');}
});
