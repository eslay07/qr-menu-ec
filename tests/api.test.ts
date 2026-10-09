import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import QRCode from 'qrcode';
import sharp from 'sharp';
import jsQR from 'jsqr';
import { handleApi } from '../lib/api';
import { Catalog, demoCatalog } from '../lib/contracts';
import type { Store, Stored } from '../lib/store';
import type { OrderRecord, OrderStore } from '../lib/orders';

const pair = generateKeyPairSync('ed25519');
const publicKey = Buffer.from(
  pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32),
).toString('base64');

void test('editor version is private, minimal and follows catalog and permission changes without crossing restaurants', async () => {
  const anonymous = harness();
  assert.equal((await anonymous.call('editor-version')).status, 404, 'an unconfigured restaurant is not exposed');
  const first = await configured();
  const second = await configured();
  const baseline = await first.h.call('editor-version');
  assert.equal(baseline.status, 200);
  assert.match(baseline.headers.get('cache-control') || '', /no-store/);
  assert.deepEqual(Object.keys(baseline.body).sort(), ['entitlements', 'features', 'revision']);
  assert.equal(baseline.body.revision, first.state.revision);
  const secondVersion = await second.h.call('editor-version');
  const secondCookie = second.h.sessionCookie();
  second.h.useCookie(first.h.sessionCookie());
  assert.equal((await second.h.call('editor-version')).status, 401, 'a session of another restaurant cannot read its editor version');
  second.h.useCookie(secondCookie);
  const changedDraft = { ...first.state.draft, description: 'Cambio externo QA FICTICIO' };
  assert.equal((await first.h.call('draft', 'PUT', { revision: first.state.revision, catalog: changedDraft })).status, 200);
  assert.equal((await first.h.call('editor-version')).body.revision, first.state.revision + 1);
  assert.deepEqual((await second.h.call('editor-version')).body, secondVersion.body);
  first.h.setPlan('basic');
  assert.equal((await first.h.call('editor-version')).body.entitlements.push, false);
  assert.equal((await first.h.call('editor-version', 'POST', {})).status, 404);
  await first.h.call('logout', 'POST', {});
  assert.equal((await first.h.call('editor-version')).status, 401);
});

test('owner plan gates are enforced on the server without blocking public basic ordering',async()=>{
 const {h}=await configured();h.setPlan('basic');
 assert.equal((await h.call('reports/orders')).status,403);
 assert.equal((await h.call('orders')).status,403);
 assert.equal((await h.call('settings/wifi')).status,403);
 assert.equal((await h.call('menu')).status,200);
 const state=(await h.call('state')).body;
 assert.equal(state.plan,'basic');assert.equal(state.entitlements.push,false);
 assert.equal((await h.call('draft','PUT',{revision:state.revision,catalog:demoCatalog,access:{plan:'premium'}})).status,400);
 h.setPlan('medium');assert.equal((await h.call('reports/orders')).status,200);assert.equal((await h.call('settings/wifi')).status,403);
});

function harness(features: Array<'orders' | 'promotions'> = ['orders']) {
  let canonicalUrl: string | undefined = 'https://mesa.menus.test/menu';
  let data: Stored | null = null,
    ownerAccess = true;
  const media = new Map<string, { bytes: Uint8Array; type: string }>(),
    orders = new Map<string, { order: OrderRecord; hash: string }>();
  const store: Store = {
    async read() {
      return structuredClone(data);
    },
    async commit(state, revision) {
      if (
        revision === null ? data !== null : !data || data.revision !== revision
      )
        return false;
      data = {
        state: structuredClone(state),
        revision: revision === null ? 0 : revision + 1,
      };
      return true;
    },
    async mediaGet(id) {
      return media.get(id) || null;
    },
    async mediaPut(id, bytes, type) {
      media.set(id, { bytes, type });
    },
  };
  const orderStore: OrderStore = {
    async create(order, hash) {
      orders.set(order.id, { order: structuredClone(order), hash });
    },
    async publicByTokenHash(hash) {
      return structuredClone(
        [...orders.values()].find((item) => item.hash === hash)?.order || null,
      );
    },
    async list(restaurantId) {
      return structuredClone(
        [...orders.values()]
          .map((item) => item.order)
          .filter(
            (order) => order.restaurantId === restaurantId && !order.demo,
          ),
      );
    },
    async setStatus(restaurantId, id) {
      const found = orders.get(id);
      if (
        !found ||
        found.order.restaurantId !== restaurantId ||
        found.order.status !== 'confirmed'
      )
        return false;
      found.order.status = 'cancelled';
      found.order.cancelledAt = new Date().toISOString();
      return true;
    },
  };
  let cookie = '';
  return {
    sessionCookie() { return cookie; },
    useCookie(value: string) { cookie = value; },
    setCanonicalUrl(value: string | undefined) { canonicalUrl = value; },
    setPlan(plan:'basic'|'medium'|'premium') { if(!data)throw Error('Create first');data.state.access={...data.state.access,active:true,plan}; },
    seedOrder(order: OrderRecord) { orders.set(order.id, { order: structuredClone(order), hash: `fixture-${order.id}` }); },
    async call(path: string, method = 'GET', value?: unknown, origin?: string) {
      const response = await handleApi(
        new Request(`https://menu.test/api/v1/${path}`, {
          method,
          headers: {
            cookie,
            ...(value !== undefined
              ? { 'Content-Type': 'application/json' }
              : {}),
            ...(origin ? { origin } : {}),
          },
          body: value !== undefined ? JSON.stringify(value) : undefined,
        }),
        store,
        {
          publicKey,
          setupToken: 'setup-secret',
          runtime: 'cloud',
          ownerAccess,
          grantedFeatures: features,
          orderStore,
          publicMenuUrl: canonicalUrl,
        },
      );
      if (response.headers.has('set-cookie'))
        cookie = response.headers.get('set-cookie')!.split(';')[0];
      const contentType = response.headers.get('content-type') || '';
      return {
        status: response.status,
        body: contentType.includes('json')
          ? ((await response.json()) as any)
          : await response.arrayBuffer(),
        headers: response.headers,
      };
    },
    license(restaurantId: string) {
      const bytes = Buffer.from(
        JSON.stringify({
          schemaVersion: 1,
          restaurantId,
          licenseId: 'test-license',
          modes: ['web'],
          issuedAt: new Date().toISOString(),
          customer: 'Prueba',
        }),
      );
      return {
        payload: bytes.toString('base64'),
        signature: Buffer.from(sign(null, bytes, pair.privateKey)).toString(
          'base64',
        ),
      };
    },
    suspend() {
      ownerAccess = false;
    },
    setPolicy(maxDishes: number, sampleMenuEnabled: boolean) {
      if (!data) throw Error('Create restaurant first');
      data.state.access = { ...data.state.access, active: true, maxDishes, sampleMenuEnabled };
    },
    orders,
  };
}

async function decode(payload: string) {
  const png = await QRCode.toBuffer(payload, {
    type: 'png',
    width: 1000,
    margin: 4,
    errorCorrectionLevel: 'M',
  });
  const image = await (sharp as any)(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return jsQR(
    new Uint8ClampedArray(image.data),
    image.info.width,
    image.info.height,
  )?.data;
}
async function configured() {
  const h = harness(),
    setup = await h.call('setup', 'POST', {
      name: 'Mesa',
      password: 'test-password-123',
      setupToken: 'setup-secret',
    });
  let state = (await h.call('state')).body;
  await h.call('draft', 'PUT', {
    revision: state.revision,
    catalog: demoCatalog,
  });
  state = (await h.call('state')).body;
  await h.call('settings', 'PUT', {
    revision: state.revision,
    settings: { webUrl: 'https://mesa.menus.test/menu', ordersEnabled: true },
  });
  state = (await h.call('state')).body;
  await h.call('publish', 'POST', { revision: state.revision });
  return { h, setup, state: (await h.call('state')).body };
}

test('legacy catalogs gain empty modifier groups', () => {
  const legacy = structuredClone(demoCatalog) as any;
  delete legacy.dishes[0].modifierGroups;
  const parsed = Catalog.parse(legacy);
  assert.deepEqual(parsed.dishes[0].modifierGroups, []);
});

test('sample replacement requires creator permission, explicit consent and respects the assigned dish cap', async () => {
  const h = harness();
  await h.call('setup', 'POST', { name: 'Mesa', password: 'test-password-123', setupToken: 'setup-secret' });
  let state = (await h.call('state')).body;
  assert.equal((await h.call('sample-menu', 'POST', { revision: state.revision, confirm: true })).status, 403);
  h.setPolicy(40, true);
  assert.equal((await h.call('sample-menu', 'POST', { revision: state.revision, confirm: false })).status, 400);
  assert.equal((await h.call('sample-menu', 'POST', { revision: state.revision, confirm: true })).status, 200);
  state = (await h.call('state')).body;
  assert.equal(state.draft.dishes.length, 40);
  assert.equal(state.published, null);
  assert.equal((await h.call('sample-menu', 'POST', { revision: state.revision - 1, confirm: true })).status, 409);
  h.setPolicy(1, false);
  assert.equal((await h.call('draft', 'PUT', { revision: state.revision, catalog: state.draft })).status, 400);
});

test('one permanent HTTPS menu QR is produced', async () => {
  const { h } = await configured();
  const result = await h.call('qr');
  assert.deepEqual(
    result.body.codes.map((code: any) => code.kind),
    ['web'],
  );
  assert.equal(
    await decode(result.body.codes[0].payload),
    'https://mesa.menus.test/menu',
  );
  assert.doesNotMatch(result.body.codes[0].payload, /WIFI:/);
});

test('configured order pricing is rebuilt on the server', async () => {
  const { h } = await configured();
  const result = await h.call('orders', 'POST', {
    alias: 'Ana',
    expectedTotalCents: 1500,
    lines: [
      {
        dishId: 'desayuno-continental',
        quantity: 2,
        note: 'sin azúcar',
        selections: [
          { groupId: 'bebida-caliente', optionIds: ['cafe'] },
          { groupId: 'jugo', optionIds: ['naranja'] },
          { groupId: 'extras', optionIds: ['huevo'] },
        ],
      },
    ],
  });
  assert.equal(result.status, 201);
  assert.equal(result.body.order.totalCents, 1500);
  assert.equal(result.body.order.lines[0].options.length, 3);
  assert.match(result.body.publicUrl, /\/order\//);
  assert.match(result.body.pdfUrl, /\/api\/v1\/order\/[^/]+\/pdf$/);
  const token = result.body.publicUrl.split('/').pop();
  const publicOrder = await h.call(`order/${token}`);
  assert.equal(publicOrder.body.order.alias, 'Ana');
  const pdf = await h.call(`order/${token}/pdf`);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.ok((pdf.body as ArrayBuffer).byteLength > 1000);
});

test('QR fallback never uses a stale legacy webUrl',async()=>{
 const {h}=await configured();h.setCanonicalUrl(undefined);
 const qr=await h.call('qr');assert.equal(qr.status,200);
 assert.equal(await decode(qr.body.codes[0].payload),'https://menu.test/menu');
});

test('invalid modifier choices and disabled ordering are rejected', async () => {
  const { h } = await configured();
  const missing = await h.call('orders', 'POST', {
    alias: '',
    lines: [
      { dishId: 'desayuno-continental', quantity: 1, note: '', selections: [] },
    ],
  });
  assert.equal(missing.status, 400);
  const withoutFeature = harness([]);
  await withoutFeature.call('setup', 'POST', {
    name: 'Mesa',
    password: 'test-password-123',
    setupToken: 'setup-secret',
  });
  const state = (await withoutFeature.call('state')).body;
  assert.equal(
    (
      await withoutFeature.call('settings', 'PUT', {
        revision: state.revision,
        settings: { webUrl: '', ordersEnabled: true },
      })
    ).status,
    403,
  );
});

test('customer cancellation requires confirmation and same origin, preserves history and is idempotent', async () => {
  const { h } = await configured();
  const created = await h.call('orders', 'POST', {
    alias: 'Ana', expectedTotalCents: 750,
    lines: [{ dishId: 'seco', quantity: 1, note: '', selections: [] }],
  });
  assert.equal(created.status, 201);
  const token = created.body.publicUrl.split('/').pop();
  const path = `order/${token}/cancel`;
  assert.equal((await h.call(path, 'POST', { confirm: true }, 'https://attacker.test')).status, 403);
  assert.equal((await h.call(path, 'POST', { confirm: false }, 'https://menu.test')).status, 400);
  assert.equal((await h.call(path, 'POST', { confirm: true }, 'https://menu.test')).status, 200);
  assert.equal((await h.call(path, 'POST', { confirm: true }, 'https://menu.test')).status, 200);
  const order = (await h.call(`order/${token}`)).body.order;
  assert.equal(order.status, 'cancelled');
  assert.equal(order.lines.length, 1);
  const report = (await h.call('reports/orders')).body.report;
  assert.equal(report.cancelledOrders, 1);
  assert.equal(report.confirmedOrders, 0);
});

test('reports paginate without losing totals, reject mismatched cursors and never truncate exports silently', async () => {
  const { h } = await configured();
  const created = await h.call('orders', 'POST', { alias: 'Prueba', expectedTotalCents: 750, lines: [{ dishId: 'seco', quantity: 1, note: '', selections: [] }] });
  for (let i = 0; i < 60; i++) h.seedOrder({ ...created.body.order, id: crypto.randomUUID() });
  const first = await h.call('reports/orders');
  assert.equal(first.body.orders.length, 50);
  assert.equal(first.body.report.confirmedOrders, 61);
  assert.equal(first.body.report.totalCents, 61 * 750);
  const second = await h.call(`reports/orders${first.body.nextPageQuery}`);
  assert.equal(second.body.orders.length, 11);
  assert.equal(second.body.nextCursor, null);
  assert.equal(new Set([...first.body.orders, ...second.body.orders].map(order => order.id)).size, 61);
  const forged = { ...JSON.parse(atob(first.body.nextCursor)), restaurantId: crypto.randomUUID() };
  assert.equal((await h.call(`reports/orders?cursor=${encodeURIComponent(btoa(JSON.stringify(forged)))}`)).status, 400);
  assert.equal((await h.call('reports/orders?from=not-a-date')).status, 400);
  for (let i = 61; i < 5001; i++) h.seedOrder({ ...created.body.order, id: crypto.randomUUID() });
  assert.equal((await h.call('reports/orders')).status, 400);
  assert.equal((await h.call('reports/orders.csv')).status, 400);
});

test('reports exclude cancelled orders', async () => {
  const { h } = await configured();
  const created = await h.call('orders', 'POST', {
    alias: 'Mesa 4',
    expectedTotalCents: 750,
    lines: [{ dishId: 'seco', quantity: 1, note: '', selections: [] }],
  });
  let report = await h.call('reports/orders');
  assert.equal(report.body.report.confirmedOrders, 1);
  assert.equal(report.body.report.totalCents, 750);
  await h.call(`orders/${created.body.order.id}/status`, 'PATCH', {
    status: 'cancelled',
  });
  report = await h.call('reports/orders');
  assert.equal(report.body.report.confirmedOrders, 0);
  assert.equal(report.body.report.cancelledOrders, 1);
});

test('active promotions are snapshotted and stale totals are rejected', async () => {
  const h = harness(['orders', 'promotions']);
  await h.call('setup', 'POST', {
    name: 'Mesa',
    password: 'test-password-123',
    setupToken: 'setup-secret',
  });
  let state = (await h.call('state')).body;
  await h.call('draft', 'PUT', {
    revision: state.revision,
    catalog: demoCatalog,
  });
  state = (await h.call('state')).body;
  await h.call('settings', 'PUT', {
    revision: state.revision,
    settings: { webUrl: '', ordersEnabled: true },
  });
  state = (await h.call('state')).body;
  await h.call('publish', 'POST', { revision: state.revision });
  const stale = await h.call('orders', 'POST', {
    alias: 'Luis',
    expectedTotalCents: 650,
    lines: [
      {
        dishId: 'desayuno-continental',
        quantity: 1,
        note: '',
        selections: [
          { groupId: 'bebida-caliente', optionIds: ['cafe'] },
          { groupId: 'jugo', optionIds: ['naranja'] },
          { groupId: 'extras', optionIds: [] },
        ],
      },
    ],
  });
  assert.equal(stale.status, 409);
  const accepted = await h.call('orders', 'POST', {
    alias: 'Luis',
    expectedTotalCents: 595,
    lines: [
      {
        dishId: 'desayuno-continental',
        quantity: 1,
        note: '',
        selections: [
          { groupId: 'bebida-caliente', optionIds: ['cafe'] },
          { groupId: 'jugo', optionIds: ['naranja'] },
          { groupId: 'extras', optionIds: [] },
        ],
      },
    ],
  });
  assert.equal(accepted.status, 201);
  assert.equal(
    accepted.body.order.lines[0].promotion.promotionalPriceCents,
    595,
  );
  assert.equal(accepted.body.order.lines[0].promotion.savingsCents, 55);
});

test('authentication, conflicts, suspension and recovery remain enforced', async () => {
  const h = harness();
  const setup = await h.call('setup', 'POST', {
    name: 'Mesa',
    password: 'test-password-123',
    setupToken: 'setup-secret',
  });
  assert.equal((await h.call('logout', 'POST', {})).status, 200);
  assert.equal(
    (
      await h.call('login', 'POST', {
        code: 'otro',
        password: 'test-password-123',
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await h.call('login', 'POST', {
        code: setup.body.restaurantId,
        password: 'test-password-123',
      })
    ).status,
    200,
  );
  const state = (await h.call('state')).body;
  assert.equal(
    (
      await h.call('draft', 'PUT', {
        revision: state.revision,
        catalog: demoCatalog,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await h.call('draft', 'PUT', {
        revision: state.revision,
        catalog: demoCatalog,
      })
    ).status,
    409,
  );
  assert.equal(
    (await h.call('logout', 'POST', {}, 'https://evil.test')).status,
    403,
  );
  assert.equal((await h.call('logout', 'POST', {})).status, 200);
  assert.equal(
    (
      await h.call('recover', 'POST', {
        recovery: setup.body.recovery,
        password: 'new-password-123',
      })
    ).status,
    200,
  );
  h.suspend();
  assert.equal((await h.call('session')).body.authenticated, false);
});

void test('publish rejects an unconfirmed automatic name before changing the persisted draft or revision',async()=>{
 const h=harness();await h.call('setup','POST',{name:'Mi restaurante',password:'test-password-123',setupToken:'setup-secret'});
 let state=(await h.call('state')).body;
 await h.call('draft','PUT',{revision:state.revision,catalog:{...demoCatalog,name:'Mi restaurante',nameConfirmed:false}});
 state=(await h.call('state')).body;
 const rejected=await h.call('publish','POST',{revision:state.revision});assert.equal(rejected.status,400);assert.equal(rejected.body.error,'Agrega el nombre del restaurante antes de publicar el menú.');
 const after=(await h.call('state')).body;assert.equal(after.revision,state.revision);assert.equal(after.published,null);assert.equal(after.draft.name,'Mi restaurante');
 await h.call('draft','PUT',{revision:state.revision,catalog:{...after.draft,nameConfirmed:true}});state=(await h.call('state')).body;
 assert.equal((await h.call('publish','POST',{revision:state.revision})).status,200);
});
void test('WhatsApp prepares a priced request without inserting an internal order and respects feature gates',async()=>{
 const {h}=await configured();let state=(await h.call('state')).body;
 const contact={address:'Prueba ficticia',phone:'',whatsapp:'+593990000000',hours:[]};
 await h.call('draft','PUT',{revision:state.revision,catalog:{...state.draft,contact}});state=(await h.call('state')).body;await h.call('publish','POST',{revision:state.revision});
 const input={alias:'Ensayo',lines:[{dishId:'jugo',quantity:2,selections:[],note:''}],expectedTotalCents:500};
 const response=await h.call('whatsapp-request','POST',input);assert.equal(response.status,200);assert.equal(response.body.registered,false);assert.equal(response.body.model,'request');assert.match(response.body.url,/^https:\/\/wa\.me\/593990000000/);assert.equal(h.orders.size,0);
 assert.equal((await h.call('whatsapp-request','POST',{...input,expectedTotalCents:1})).status,409);
 state=(await h.call('state')).body;await h.call('settings','PUT',{revision:state.revision,settings:{webUrl:'',ordersEnabled:false}});assert.equal((await h.call('whatsapp-request','POST',input)).status,403);
});
