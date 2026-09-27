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

function harness(features: Array<'orders' | 'promotions'> = ['orders']) {
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
          publicMenuUrl: 'https://mesa.menus.test/menu',
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
