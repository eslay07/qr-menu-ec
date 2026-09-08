import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import QRCode from 'qrcode';
import sharp from 'sharp';
import jsQR from 'jsqr';
import { handleApi } from '../lib/api';
import { buildOfflineText, defaultSettings, demoCatalog, textPages, wifiPayload, TEXT_QR_MAX_BYTES, OFFLINE_TEXT_QR_MAX_BYTES } from '../lib/contracts';
import type { Store, Stored } from '../lib/store';

const pair = generateKeyPairSync('ed25519');
const publicKey = Buffer.from(pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32)).toString('base64');

function harness() {
  let data: Stored | null = null;
  const media = new Map<string, { bytes: Uint8Array; type: string }>();
  const store: Store = {
    async read() { return structuredClone(data); },
    async commit(state, revision) {
      if (revision === null ? data !== null : !data || data.revision !== revision) return false;
      data = { state: structuredClone(state), revision: revision === null ? 0 : revision + 1 };
      return true;
    },
    async mediaGet(id) { return media.get(id) || null; },
    async mediaPut(id, bytes, type) { media.set(id, { bytes, type }); },
  };
  let cookie = '';
  return {
    async call(path: string, method = 'GET', body?: unknown, origin?: string) {
      const request = new Request('https://menu.test/api/v1/' + path, {
        method,
        headers: { cookie, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(origin ? { origin } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const response = await handleApi(request, store, { publicKey, setupToken: 'setup-secret', runtime: 'local' });
      if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie')!.split(';')[0];
      return { status: response.status, body: await response.json() as any };
    },
    signLicense(restaurantId: string, modes = ['dual_web_vcard']) {
      const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, restaurantId, licenseId: 'test-license', modes, issuedAt: new Date().toISOString(), customer: 'Prueba' }));
      return { payload: bytes.toString('base64'), signature: Buffer.from(sign(null, bytes, pair.privateKey)).toString('base64') };
    },
  };
}

async function decode(payload: string) {
  const png = await QRCode.toBuffer(payload, { type: 'png', width: 1200, margin: 4, errorCorrectionLevel: 'M' });
  const image = await (sharp as any)(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return jsQR(new Uint8ClampedArray(image.data), image.info.width, image.info.height)?.data;
}

test('dual mode is the default and API returns exactly web plus offline text QR', async () => {
  const h = harness();
  const setup = await h.call('setup', 'POST', { name: 'Mesa', password: 'test-password-123', setupToken: 'setup-secret' });
  assert.equal(setup.status, 201);
  assert.equal((await h.call('logout', 'POST', {})).status, 200);
  assert.equal((await h.call('login', 'POST', { code: 'otro-local', password: 'test-password-123' })).status, 401);
  assert.equal((await h.call('login', 'POST', { code: setup.body.restaurantId, password: 'test-password-123' })).status, 200);
  let state = (await h.call('state')).body;
  assert.equal(state.settings.mode, 'dual_web_vcard');
  assert.equal((await h.call('publish', 'POST', { revision: state.revision })).status, 403);
  assert.equal((await h.call('license', 'POST', h.signLicense(setup.body.restaurantId))).status, 200);
  state = (await h.call('state')).body;
  assert.equal((await h.call('draft', 'PUT', { revision: state.revision, catalog: demoCatalog })).status, 200);
  state = (await h.call('state')).body;
  const settings = {
    ...state.settings,
    webUrl: 'https://qr-menu-resuelven.pages.dev/restaurante-demo',
    offlineCard: { ...state.settings.offlineCard, phone: '+593 99 000 0000', address: 'Calle 1; Centro, Ecuador', hours: 'Lun-Dom 08:00-22:00' },
  };
  assert.equal((await h.call('settings', 'PUT', { revision: state.revision, settings })).status, 200);
  state = (await h.call('state')).body;
  assert.equal((await h.call('publish', 'POST', { revision: state.revision })).status, 200);
  const packageResult = await h.call('qr');
  assert.equal(packageResult.status, 200);
  assert.deepEqual(packageResult.body.codes.map((code: any) => code.kind), ['web', 'offline_text']);
  assert.equal(packageResult.body.codes.length, 2);
  assert.equal(await decode(packageResult.body.codes[0].payload), settings.webUrl);
  assert.equal(await decode(packageResult.body.codes[1].payload), packageResult.body.codes[1].payload);
  assert.match(packageResult.body.codes[1].payload, /^━|^\*\*/);
  assert.match(packageResult.body.codes[1].payload, /\/\/ MENÚ · PRECIOS EN USD \/\//);
  assert.doesNotMatch(packageResult.body.codes[1].payload, /BEGIN:VCARD|VERSION:3\.0|NOTE:/);
  assert.equal(packageResult.body.offlineText, packageResult.body.codes[1].payload);
  assert.ok(packageResult.body.offlineBytes <= OFFLINE_TEXT_QR_MAX_BYTES);
  assert.equal(packageResult.body.offlineReprintRequired, true);
  assert.equal((await h.call('qr/printed', 'POST', {})).status, 200);
  assert.equal((await h.call('state')).body.offlineReprintRequired, false);
});

test('offline text preserves UTF-8 and visual symbols without contact metadata', () => {
  const catalog = {
    ...demoCatalog,
    name: 'Café \\ Norte; Centro, Quito',
    dishes: [{ ...demoCatalog.dishes[0], name: 'Ceviche, limón; ají \\ especial', description: 'Tildes: áéíóú, ñ y texto seguro\nsegunda línea.' }],
  };
  const result = buildOfflineText(catalog, {
    ...defaultSettings,
    webUrl: 'https://example.com/menu',
    offlineCard: { ...defaultSettings.offlineCard, address: 'Av. Uno; local 2, Quito', phone: '+593 2 000 0000', hours: 'Lunes a domingo' },
  });
  assert.equal(result.fits, true);
  assert.match(result.payload, /\*\* CAFÉ \\ NORTE; CENTRO, QUITO \*\*/);
  assert.match(result.payload, /\/\/ MENÚ · PRECIOS EN USD \/\//);
  assert.match(result.payload, /◆ NUESTRA COCINA/);
  assert.match(result.payload, /• Ceviche, limón; ají \\ especial — \$6\.50/);
  assert.match(result.payload, /\/ Tildes: áéíóú, ñ y texto seguro segunda línea\. \//);
  assert.match(result.payload, /DIR: Av\. Uno; local 2, Quito/);
  assert.doesNotMatch(result.payload, /BEGIN:VCARD|VERSION:3\.0|NOTE:/);
});

test('offline text omits longest descriptions first and never removes names or prices', () => {
  const catalog = {
    ...demoCatalog,
    dishes: Array.from({ length: 12 }, (_, index) => ({
      ...demoCatalog.dishes[0],
      id: 'dish-' + index,
      name: 'Plato esencial ' + index,
      description: 'Descripción extensa '.repeat(index + 3),
      image: '',
    })),
  };
  const result = buildOfflineText(catalog, { ...defaultSettings, webUrl: 'https://example.com/menu' });
  assert.equal(result.fits, true);
  assert.ok(result.omittedDescriptions.length > 0);
  assert.equal(result.omittedDescriptions[0], 'Plato esencial 11');
  for (let index = 0; index < 12; index++) {
    assert.match(result.payload, new RegExp(`Plato esencial ${index} — \\$6\\.50`));
  }
  assert.ok(result.bytes <= OFFLINE_TEXT_QR_MAX_BYTES);
});

test('essential overflow is reported without mutating the catalog', () => {
  const catalog = {
    ...demoCatalog,
    categories: [{ id: 'largos', name: 'Categoría de nombres esenciales' }],
    dishes: Array.from({ length: 80 }, (_, index) => ({ ...demoCatalog.dishes[0], id: 'e' + index, categoryId: 'largos', name: `Plato esencial número ${index}`, description: '', image: '' })),
  };
  const before = structuredClone(catalog);
  const result = buildOfflineText(catalog, { ...defaultSettings, webUrl: 'https://example.com/menu' });
  assert.equal(result.fits, false);
  assert.ok(result.bytes > OFFLINE_TEXT_QR_MAX_BYTES);
  assert.ok(result.offendingDish);
  assert.deepEqual(catalog, before);
});

test('legacy text and local modes remain valid', () => {
  assert.match(wifiPayload({ ...defaultSettings, ssid: 'Mesa;:A' }), /S:Mesa\\;\\:A/);
  const catalog = { ...demoCatalog, dishes: Array.from({ length: 150 }, (_, index) => ({ ...demoCatalog.dishes[0], id: 'd' + index, name: 'Plato ecuatoriano número ' + index, image: '' })) };
  const pages = textPages(catalog);
  assert.ok(pages.length > 1);
  for (const [index, page] of pages.entries()) {
    assert.ok(new TextEncoder().encode(page).length <= TEXT_QR_MAX_BYTES);
    assert.match(page, new RegExp(`PARTE ${index + 1} DE ${pages.length}$`));
  }
});

test('draft conflicts, recovery and published snapshots remain atomic', async () => {
  const h = harness();
  const setup = await h.call('setup', 'POST', { name: 'Mesa', password: 'test-password-123', setupToken: 'setup-secret' });
  await h.call('license', 'POST', h.signLicense(setup.body.restaurantId, ['local', 'text']));
  let state = (await h.call('state')).body;
  assert.equal((await h.call('draft', 'PUT', { revision: state.revision, catalog: demoCatalog })).status, 200);
  assert.equal((await h.call('draft', 'PUT', { revision: state.revision, catalog: demoCatalog })).status, 409);
  state = (await h.call('state')).body;
  assert.equal((await h.call('settings', 'PUT', { revision: state.revision, settings: { ...state.settings, mode: 'local' } })).status, 200);
  state = (await h.call('state')).body;
  assert.equal((await h.call('publish', 'POST', { revision: state.revision })).status, 200);
  state = (await h.call('state')).body;
  await h.call('draft', 'PUT', { revision: state.revision, catalog: { ...demoCatalog, name: 'Borrador nuevo' } });
  assert.equal((await h.call('menu')).body.catalog.name, 'La Mesa');
  assert.equal((await h.call('logout', 'POST', {}, 'https://evil.test')).status, 403);
  assert.equal((await h.call('logout', 'POST', {})).status, 200);
  assert.equal((await h.call('state')).status, 401);
  const recovered = await h.call('recover', 'POST', { recovery: setup.body.recovery, password: 'new-password-123' });
  assert.equal(recovered.status, 200);
  assert.notEqual(recovered.body.recovery, setup.body.recovery);
});
