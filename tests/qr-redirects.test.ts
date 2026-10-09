import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register(new URL('./cloudflare-test-loader.mjs', import.meta.url));
const { default: worker, auditRoute } = await import('../deployment/cloudflare/worker');

void test('audit routes do not retain opaque order credentials', () => {
  assert.equal(auditRoute('/api/v1/order/private-bearer-token/pdf'), '/api/v1/order/:token/pdf');
  assert.equal(auditRoute('/api/v1/order/private-bearer-token/cancel'), '/api/v1/order/:token/cancel');
});

void test('UUID and free aliases redirect once to active primary without loops or crossing restaurants', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const other = '22222222-2222-4222-8222-222222222222';
  const records = [{ hostname: 'free.example.com', restaurant_id: id, priority: 10 }, { hostname: 'menu.example.com', restaurant_id: id, priority: 100 }, { hostname: 'other.example.com', restaurant_id: other, priority: 100 }];
  const env = { DB: { prepare(sql: string) { let values: unknown[] = []; return { bind(...args: unknown[]) { values = args; return this; }, async first() {
    if (sql.includes('SELECT restaurant_id,kind')) return records.find(row => row.hostname === values[0]) || null;
    if (sql.includes('SELECT hostname')) return records.filter(row => row.restaurant_id === values[0] && (!sql.includes('hostname <>') || row.hostname !== values[1])).sort((a, b) => b.priority - a.priority)[0] || null;
    throw Error('Unexpected SQL');
  } }; } }, ASSETS: { fetch: async () => new Response('local assets') } } as unknown as Parameters<typeof worker.fetch>[1];
  const context = { waitUntil() {} } as unknown as ExecutionContext;
  const request = (url: string) => worker.fetch(new Request(url), env, context);
  const http = await request(`http://core.example.com/r/${id}/menu`);
  assert.equal(http.status, 308);
  assert.equal(http.headers.get('location'), `https://core.example.com/r/${id}/menu`);
  for (const url of [`https://core.example.com/r/${id}/menu`, 'https://free.example.com/menu']) {
    const response = await request(url);
    assert.equal(response.headers.get('location'), 'https://menu.example.com/menu');
    assert.equal((await request(response.headers.get('location')!)).status, 200);
  }
  assert.equal((await request(`https://core.example.com/r/${other}/menu`)).headers.get('location'), 'https://other.example.com/menu');
  const trailing = await request(`https://core.example.com/r/${id}/menu/?table=4`);
  assert.equal(trailing.status, 308);
  const canonical = await request(trailing.headers.get('location')!);
  assert.equal(canonical.headers.get('location'), 'https://menu.example.com/menu?table=4');
  assert.equal((await request(canonical.headers.get('location')!)).status, 200);
  assert.equal((await request(`https://core.example.com/r/${id}/`)).status, 200); // Private administration does not change cookie origin.
});
