import test from 'node:test';
import assert from 'node:assert/strict';
import { FirestoreRest, firestoreHashId } from '../lib/firestore-rest';
import { FirestoreRestaurantStore } from '../lib/firestore-store';
import { FirestoreBackupRepository } from '../lib/firestore-backups';
import { FirestoreOrderStore } from '../lib/firestore-orders';
import { blankCatalog, defaultSettings } from '../lib/contracts';
import type { State } from '../lib/store';
import type { OrderRecord } from '../lib/orders';

void test('monthly isolated drill restores catalog and missing order lines and verifies checksum', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
  // Hard-coded demo project and loopback-only transport: never reads live data.
  const db = new FirestoreRest('demo-qr-menu-ec', process.env.FIRESTORE_EMULATOR_HOST!);
  const id = crypto.randomUUID();
  const imageId = crypto.randomUUID();
  const pixels = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=', 'base64'));
  const files = new Map<string, { bytes: Uint8Array; type: string }>([[imageId, { bytes: pixels, type: 'image/png' }]]);
  const media = { async mediaGet(key: string) { return files.get(key) || null; }, async mediaPut(key: string, bytes: Uint8Array, type: string) { files.set(key, { bytes, type }); } };
  const store = new FirestoreRestaurantStore(db, id, media);
  const state: State = { schemaVersion: 1, restaurantId: id, ownerId: id, draft: structuredClone(blankCatalog), settings: structuredClone(defaultSettings), published: null, license: null, password: { salt: '', hash: '' }, recoveryHash: '', sessionEpoch: 1, failures: { count: 0, until: 0 }, createdAt: new Date().toISOString(), access: { active: true, features: ['orders'], maxDishes: 150 } };
  state.draft.dishes.push({ id: 'dish-drill', name: 'Plato de ensayo', categoryId: 'principales', description: '', priceCents: 500, available: true, image: `/api/v1/media/${imageId}`, modifierGroups: [] });
  assert.equal(await store.commit(state, null), true);
  const orders = new FirestoreOrderStore(db);
  const order: OrderRecord = { id: crypto.randomUUID(), restaurantId: id, number: 'ENSAYO', status: 'confirmed', demo: false, alias: 'Ensayo ficticio', restaurantName: 'Ensayo', menuVersion: 1, currency: 'USD', totalCents: 500, createdAt: new Date().toISOString(), publicExpiresAt: new Date(Date.now() + 60000).toISOString(), cancelledAt: null, lines: [{ id: 'line-1', dishId: 'dish-drill', dishName: 'Plato de ensayo', quantity: 1, basePriceCents: 500, unitPriceCents: 500, totalCents: 500, note: '', options: [] }] };
  await orders.create(order, `drill-${id}`);
  const backups = new FirestoreBackupRepository(db, id, store);
  const backupId = await backups.automatic();
  assert.ok(backupId);
  assert.equal(await backups.automatic(), null);
  const snapshot = await backups.read(backupId);
  assert.equal(snapshot.media.length, 1);
  files.delete(imageId);
  // Simulate loss only in this test's randomly allocated fixture.
  await db.commit([{ path: `restaurants/${id}/orders/${order.id}/lines/line-1`, delete: true }, { path: `platformConfig/orderTokens/entries/${firestoreHashId(`drill-${id}`)}`, delete: true }]);
  state.draft.dishes = [];
  assert.equal(await store.commit(state, 0), true);
  assert.equal(await backups.restoreComplete(backupId, 1), true);
  assert.deepEqual((await store.read())?.state.draft, snapshot.draft);
  assert.deepEqual(await orders.read(id, order.id), order);
  assert.deepEqual(await orders.publicByTokenHash(`drill-${id}`), order);
  assert.deepEqual(files.get(imageId)?.bytes, pixels);
  await db.commit([{ path: `${backups.path}/${backupId}/chunks/0000`, data: { content: 'corrupted drill fixture' } }]);
  await assert.rejects(backups.read(backupId), /alterado/);
});
