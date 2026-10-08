import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FirestoreRest, firestoreHashId } from '../lib/firestore-rest';
import { FirestoreRestaurantStore } from '../lib/firestore-store';
import { FirestoreOrderStore } from '../lib/firestore-orders';
import { FirestoreBusinessRepository, businessSnapshot, findFirestoreOwner } from '../lib/firestore-business';
import { FirestoreBackupRepository } from '../lib/firestore-backups';
import { migrateBusinessToEmulator, importServerRowsToEmulator, importCreatorToEmulator } from '../lib/firestore-migration';
import { blankCatalog, defaultSettings } from '../lib/contracts';
import type { State } from '../lib/store';
import type { OrderRecord } from '../lib/orders';
import { AuthSecurity } from '../lib/auth-security';
import { FirestoreSecurityRepository } from '../lib/firestore-security';
import { FirestoreDomainRepository } from '../lib/firestore-domains';
import { DomainService } from '../lib/domains';
import { RestaurantPreferences } from '../lib/restaurant-preferences';
import { firestoreMaintenance } from '../lib/firestore-maintenance';
import { cleanupCatalogVersions } from '../lib/firestore-version-cleanup';

test('maintenance paginates expired aliases without deleting real orders and purges expired public links', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
  const db = new FirestoreRest('demo-qr-menu-ec', process.env.FIRESTORE_EMULATOR_HOST!);
  const rid = crypto.randomUUID();
  const base = `restaurants/${rid}`;
  await db.commit([{ path: base, data: { access: { active: false }, createdAt: new Date(0) }, exists: false }]);
  await db.commit(Array.from({ length: 205 }, (_, i) => ({
    path: `${base}/orders/order-${String(i).padStart(3, '0')}`,
    data: { alias: i < 200 ? '' : 'Borrar alias', demo: false, publicExpiresAt: new Date(0), totalCents: 500, status: 'confirmed' },
    exists: false,
  })));
  const tokenPath = `platformConfig/orderTokens/entries/expired-maintenance-${rid}`;
  await db.commit([{ path: tokenPath, data: { restaurantId: rid, expiresAt: new Date(0) }, exists: false }]);
  await firestoreMaintenance(db);
  const retained = await db.all(`${base}/orders`, 300);
  assert.equal(retained.length, 205);
  assert.ok(retained.every(row => row.data.alias === '' && row.data.totalCents === 500 && row.data.status === 'confirmed'));
  assert.equal(await db.get(tokenPath), null);
});

test('historical server imports resume, preserve domain reservations and reject changed destinations', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
  const db = new FirestoreRest('demo-qr-menu-ec', process.env.FIRESTORE_EMULATOR_HOST!);
  const rid = crypto.randomUUID(), hostname = `menu-${rid}.example.test`, now = new Date().toISOString();
  const row = { hostname, restaurant_id: rid, kind: 'custom', status: 'active', validation_data: '{"ssl":{"status":"active"}}', created_at: now, updated_at: now, priority: 30, provider: 'cloudflare_for_saas', service_name: null, cloudflare_id: 'test', last_error: null };
  await importServerRowsToEmulator(db, 'restaurant_hosts', [row]);
  await importServerRowsToEmulator(db, 'restaurant_hosts', [row]);
  assert.deepEqual((await new FirestoreDomainRepository(db).lookup(hostname))?.validation, { ssl: { status: 'active' } });
  assert.equal((await db.get(`platformConfig/hostnameKinds/entries/${rid}-custom`))?.data.hostname, hostname);
  await assert.rejects(importServerRowsToEmulator(db, 'restaurant_hosts', [{ ...row, restaurant_id: crypto.randomUUID() }]), /no se sobrescribirá/);
  const hash = `test-${crypto.randomUUID()}`;
  const grant = { id_hash: hash, restaurant_id: rid, csrf_token: 'not-a-real-token', created_at: now, last_seen_at: now, idle_expires_at: new Date(Date.now() + 60000).toISOString(), absolute_expires_at: new Date(Date.now() + 120000).toISOString(), revoked_at: null };
  await importServerRowsToEmulator(db, 'owner_devices', [grant]);
  await importServerRowsToEmulator(db, 'owner_devices', [grant]);
  const imported = await new FirestoreSecurityRepository(db).get('devices', hash);
  assert.equal(imported?.scope, 'owner');
  assert.equal(imported?.restaurant_id, rid);
  const isolated = new FirestoreRest(`demo-creator-${rid}`, process.env.FIRESTORE_EMULATOR_HOST!);
  const creator = { revision: 7, state: { security: { totpCiphertext: 'encrypted-test-only', totpEnabledAt: now }, sessionEpoch: 2 } };
  await importCreatorToEmulator(isolated, creator);
  await importCreatorToEmulator(isolated, creator);
  assert.deepEqual((await isolated.get('platformConfig/creator'))?.data, creator);
  await assert.rejects(importCreatorToEmulator(isolated, { ...creator, revision: 8 }), /no se sobrescribirá/);
});

test('Firestore transport refuses production projects and remote emulators', () => {
  assert.throws(() => new FirestoreRest('qr-menu-6981a', 'localhost:8085'));
  assert.throws(() => new FirestoreRest('demo-qr-menu-ec', 'example.com:8085'));
  assert.equal(firestoreHashId('ab/c+d=='), 'ab_c-d');
});

test('Firestore security never consults D1; scopes, revocation, rotation and challenge replay', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
  const env = { DB: new Proxy({} as D1Database, { get() { throw Error('D1 must not be called'); } }), DATA_PROVIDER: 'firestore-emulator' as const, FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST };
  const security = new AuthSecurity(env);
  const rid = crypto.randomUUID();
  const session = await security.createSession('owner', rid);
  const request = new Request('https://example.test/api', { headers: { Cookie: session.cookie.split(';')[0], Origin: 'https://example.test', 'x-csrf-token': session.csrfToken } });
  assert.equal((await security.session(request, 'owner', rid))?.csrfToken, session.csrfToken);
  assert.equal(await security.session(request, 'owner', crypto.randomUUID()), null);
  await security.revokeSubject('owner', rid);
  assert.equal(await security.session(request, 'owner', rid), null);
  const device = await security.createDevice(rid);
  const deviceRequest = new Request('https://example.test/api', { headers: { Cookie: device.cookie.split(';')[0], Origin: 'https://example.test' } });
  assert.equal((await security.device(deviceRequest))?.restaurant_id, rid);
  const rotations = await Promise.all([security.rotateDevice(deviceRequest, device.csrfToken), security.rotateDevice(deviceRequest, device.csrfToken)]);
  assert.equal(rotations.filter(Boolean).length, 1);
  assert.equal(await security.device(deviceRequest), null);
  await security.revokeDevicesForRestaurant(rid);
  assert.equal((await security.listDevices(rid)).length, 0);
  const challenge = await security.challenge('creator', null, 'mfa_login', { encrypted: 'example' });
  const challengeRequest = new Request('https://example.test', { headers: { Cookie: challenge.cookie.split(';')[0] } });
  const pending = await security.readChallenge(challengeRequest, 'creator', null);
  assert.ok(pending);
  const consumed = await Promise.allSettled([security.consumeChallenge(pending.hash), security.consumeChallenge(pending.hash)]);
  assert.equal(consumed.filter(result => result.status === 'fulfilled').length, 1);
  const action = await security.issueActionToken('owner', rid, 'password_reset', { epoch: 1 });
  assert.equal(await security.takeActionToken(action, 'owner', crypto.randomUUID(), 'password_reset'), null);
  assert.ok(await security.takeActionToken(action, 'owner', rid, 'password_reset'));
  assert.equal(await security.takeActionToken(action, 'owner', rid, 'password_reset'), null);
  await security.audit(rid, 'test', 'local-test', 'success', Date.now());
});

test('Firestore rate limit is atomic under concurrent attempts', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
  const repository = new FirestoreSecurityRepository(new FirestoreRest('demo-qr-menu-ec', process.env.FIRESTORE_EMULATOR_HOST!));
  const key = crypto.randomUUID();
  const results = await Promise.all(Array.from({ length: 10 }, () => repository.consumeLimit(key, 'test', 5, 60_000)));
  assert.equal(results.filter(result => result.allowed).length, 5);
  assert.equal((await repository.consumeLimit(key, 'test', 5, 60_000)).allowed, false);
});

test('Firestore domain aliases reserve restaurant ownership and preserve free address', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
  const env = { DB: new Proxy({} as D1Database, { get() { throw Error('D1 must not be called'); } }), DATA_PROVIDER: 'firestore-emulator' as const, FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST, PLATFORM_MENU_DOMAIN: `${crypto.randomUUID()}.example.test` };
  const service = new DomainService(env);
  const first = crypto.randomUUID(), second = crypto.randomUUID();
  const free = await service.provisionFree(first, 'La sazón', 'https://example.test');
  const collision = await service.provisionFree(second, 'La sazón', 'https://example.test');
  assert.notEqual(free, collision);
  const pending=(await service.get(first)).free!;
  assert.equal(pending.status,'pending_route');
  assert.equal((await service.get(first)).primary,null);
  await assert.rejects(service.provisionFree(first,'Otro nombre','https://example.test'),/pendiente de verificación/);
  const repository = new FirestoreDomainRepository(new FirestoreRest('demo-qr-menu-ec', process.env.FIRESTORE_EMULATOR_HOST!));
  // Emulator-only fixture: simulate completed route/TLS verification before activation.
  await repository.save({...pending,status:'active'});
  assert.equal(await service.provisionFree(first,'Otro nombre','https://example.test'),free);
  const record = (await service.get(first)).free!;
  assert.equal(record.status,'active');
  await assert.rejects(repository.save({ ...record, restaurantId: second }));
  const custom = { ...record, hostname: `${first}.custom.example.test`, kind: 'custom' as const, priority: 30, status: 'pending_validation' };
  await repository.save(custom);
  assert.equal((await repository.primary(first))?.hostname, record.hostname);
  await repository.save({ ...custom, status: 'active' });
  assert.equal((await repository.primary(first))?.hostname, custom.hostname);
  await repository.removeCustom(first);
  assert.equal((await repository.primary(first))?.hostname, record.hostname);
});

test('WiFi is encrypted and exposed only through printing; notification settings use revisions', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
  const db = new FirestoreRest('demo-qr-menu-ec', process.env.FIRESTORE_EMULATOR_HOST!);
  const rid = crypto.randomUUID();
  const security = new AuthSecurity({ DB: {} as D1Database, DATA_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64') });
  const preferences = new RestaurantPreferences(db, rid, security);
  await preferences.saveWifi({ enabled: true, name: 'Invitados', password: 'wifi-secreto' }, null);
  const general = await db.get(`restaurants/${rid}/settings/general`);
  assert.equal(JSON.stringify(general).includes('wifi-secreto'), false);
  assert.equal(JSON.stringify(await preferences.wifi()).includes('wifi-secreto'), false);
  assert.equal((await preferences.printWifi())?.text, 'WiFi gratis · Clave: wifi-secreto');
  await assert.rejects(preferences.saveWifi({ enabled: false, name: '', password: '' }, null));
  await preferences.saveWifi({ enabled: false, name: '', password: '' }, (await preferences.wifi()).revision);
  assert.equal(await preferences.printWifi(), null);
  const initial = await preferences.notifications();
  await preferences.saveNotifications({ ...initial.settings, newOrder: false }, initial.revision);
  assert.equal((await preferences.notifications()).settings.newOrder, false);
  await assert.rejects(preferences.saveNotifications({ ...initial.settings, inactivityHours: 0 }, (await preferences.notifications()).revision));
});

test('normalized Firestore repositories: isolation, CAS, publication, orders and manifests', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
  const db = new FirestoreRest('demo-qr-menu-ec', process.env.FIRESTORE_EMULATOR_HOST!);
  const rid = crypto.randomUUID();
  const media = { async mediaGet() { return null; }, async mediaPut() {} };
  const store = new FirestoreRestaurantStore(db, rid, media);
  const state: State = {
    schemaVersion: 1, restaurantId: rid, ownerId: `owner:${rid}`,
    draft: structuredClone(blankCatalog), settings: structuredClone(defaultSettings),
    published: null, license: null, password: { salt: '', hash: '' }, recoveryHash: 'private',
    sessionEpoch: 1, failures: { count: 0, until: 0 }, createdAt: new Date().toISOString(),
    access: { active: true, features: ['orders'], maxDishes: 150 },
    security: { firebaseUid: `owner:${rid}`, emailHash: `email-${rid}`, emailCiphertext: 'encrypted' },
  };
  for (let i = 0; i < 150; i++) state.draft.dishes.push({ id: `dish-${i}`, name: `Plato ${i}`, description: '', categoryId: 'principales', priceCents: 500, available: true, image: '', modifierGroups: [] });
  assert.equal(await store.commit(state, null), true);
  assert.equal(await store.commit(state, null), false);
  const read = await store.read();
  assert.equal(read?.state.draft.dishes.length, 150);
  assert.equal(read?.state.draft.dishes[10].name, 'Plato 10');
  assert.equal(read?.state.security?.emailCiphertext, 'encrypted');
  const root = await db.get(`restaurants/${rid}`);
  assert.equal('security' in root!.data, false);
  assert.equal('password' in root!.data, false);
  assert.equal('recoveryHash' in root!.data, false);
  assert.equal(await findFirestoreOwner(db, `email-${rid}`), rid);
  assert.equal((await db.get(`restaurants/${rid}/members/owner:${rid}`))?.data.active, true);
  assert.equal(await db.get(`publicMenus/${rid}`), null);
  const results = await Promise.all([store.commit(state, 0), store.commit(state, 0)]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(await store.commit(state, 0), false);
  state.published = { version: 1, at: new Date().toISOString(), catalog: structuredClone(state.draft) };
  assert.equal(await store.commit(state, 1), true);
  const publicRoot = await db.get(`publicMenus/${rid}`);
  const publicDishes = await db.all(`publicMenus/${rid}/versions/${publicRoot!.data.versionId}/dishes`, 150);
  assert.equal(publicDishes.length, 150);
  state.draft.dishes[0].name = 'Solo borrador';
  assert.equal(await store.commit(state, 2), true);
  assert.equal((await store.read())?.state.published?.catalog.dishes[0].name, 'Plato 0');
  const other = new FirestoreRestaurantStore(db, crypto.randomUUID(), media);
  await assert.rejects(other.commit(state, null), /incorrecto/);
  const otherState = { ...state, restaurantId: other.restaurantId };
  await assert.rejects(other.commit(otherState, null), /correo/);
  assert.equal(await other.read(), null);
  state.access!.maxDishes = 149;
  await assert.rejects(store.commit(state, 3), /límite/);
  state.access!.maxDishes = 150;
  state.access!.active = false;
  assert.equal(await store.commit(state, 3), true);
  assert.equal((await db.get(`restaurants/${rid}/members/owner:${rid}`))?.data.active, false);
  const orders = new FirestoreOrderStore(db);
  const order: OrderRecord = { id: crypto.randomUUID(), restaurantId: rid, number: 'PED-TEST', status: 'confirmed', demo: false, alias: 'Cliente', restaurantName: 'Test', menuVersion: 1, currency: 'USD', totalCents: 500, createdAt: new Date().toISOString(), publicExpiresAt: new Date(Date.now() + 60_000).toISOString(), cancelledAt: null,
    lines: [{ id: 'line-1', dishId: 'dish-0', dishName: 'Plato 0', quantity: 1, basePriceCents: 500, unitPriceCents: 500, totalCents: 500, note: '', options: [] }] };
  await orders.create(order, `token-${rid}`);
  assert.deepEqual(await orders.publicByTokenHash(`token-${rid}`), order);
  await assert.rejects(orders.create(order, `token-other-${rid}`));
  assert.equal((await orders.list(rid, { query: 'client' })).length, 1);
  assert.equal((await orders.list(other.restaurantId)).length, 0);
  assert.equal(await orders.setStatus(other.restaurantId, order.id, 'cancelled'), false);
  assert.deepEqual((await Promise.all([orders.setStatus(rid, order.id, 'cancelled'), orders.setStatus(rid, order.id, 'cancelled')])).sort(), [false, true]);
  const expired = { ...order, id: crypto.randomUUID(), publicExpiresAt: new Date(0).toISOString() };
  await orders.create(expired, `expired-${rid}`);
  assert.equal(await orders.publicByTokenHash(`expired-${rid}`), null);
  const business = new FirestoreBusinessRepository(db, rid);
  await business.notify({ id: 'test', kind: 'order', title: 'Pedido', message: 'Prueba', read: false, createdAt: new Date().toISOString() });
  assert.equal(await business.markRead('test'), true);
  assert.equal((await business.notifications()).documents.find(row => row.data.id === 'test')?.data.read, true);
  assert.equal(await new FirestoreBusinessRepository(db, other.restaurantId).markRead('test'), false);
  await business.recordBackup('test', { revision: 4, catalogIds: [], orderCount: 2, mediaCount: 0, checksum: 'pending', status: 'staging' });
  assert.equal((await business.backups()).documents[0].data.status, 'staging');
  assert.equal('password' in businessSnapshot(state), false);
  assert.equal('security' in businessSnapshot(state), false);
  const backups = new FirestoreBackupRepository(db, rid, store);
  const backupId = await backups.create();
  assert.equal((await backups.read(backupId)).orders.length, 2);
  assert.equal(await backups.restoreDraft(backupId, 0), false);
  assert.equal(await backups.restoreDraft(backupId, 4), true);
  assert.equal((await store.read())?.state.security?.emailCiphertext, 'encrypted');
  assert.equal(await backups.restoreComplete(backupId, 5), true);
  assert.equal((await store.read())?.state.draft.dishes.length, 150);
  assert.equal((await orders.read(rid, order.id))?.status, 'cancelled');
  assert.equal((await orders.read(rid, order.id))?.totalCents, 500);
  assert.equal((await orders.read(rid, expired.id))?.id, expired.id);
  await db.commit([{ path: `restaurants/${rid}/backups/${backupId}/chunks/0000`, data: { content: 'tampered' } }]);
  await assert.rejects(backups.read(backupId), /alterado/);
  const migratedId = crypto.randomUUID();
  const migratedState = { ...state, restaurantId: migratedId, ownerId: `owner:${migratedId}`, security: { firebaseUid: `owner:${migratedId}`, emailHash: `email-${migratedId}` } };
  const migratedOrder = { ...order, id: crypto.randomUUID(), restaurantId: migratedId };
  let interrupt = true;
  const source = {
    async *restaurants() { yield { revision: 42, state: migratedState }; },
    async *orders(id: string) { yield { order: migratedOrder, tokenHash: `migrated-${id}` }; if (interrupt) throw Error('simulated interruption'); },
  };
  const runId = crypto.randomUUID();
  await assert.rejects(migrateBusinessToEmulator(db, source, media, runId), /interrumpida/);
  interrupt = false;
  const result = await migrateBusinessToEmulator(db, source, media, runId);
  assert.equal(result.restaurants, 1);
  assert.equal(result.orders, 1);
  assert.equal((await new FirestoreRestaurantStore(db, migratedId, media).read())?.revision, 42);
  assert.equal((await migrateBusinessToEmulator(db, source, media, runId)).orders, 1);
  assert.equal((await new FirestoreBusinessRepository(db, migratedId).notifications()).documents.length, 0);
  migratedState.draft = { ...migratedState.draft, name: 'Changed source' };
  await assert.rejects(migrateBusinessToEmulator(db, source, media, runId), /interrumpida/);
  const beforeCleanup = await store.read();
  assert.equal(await cleanupCatalogVersions(db, rid, new Date(Date.now() + 31 * 86400000)), 0);
  await db.commit([{ path: `restaurants/${rid}/backups/test`, data: { status: 'failed' }, mask: ['status'] }]);
  assert.ok(await cleanupCatalogVersions(db, rid, new Date(Date.now() + 31 * 86400000)) > 0);
  assert.deepEqual((await store.read())?.state.draft, beforeCleanup?.state.draft);
  assert.deepEqual((await store.read())?.state.published, beforeCleanup?.state.published);
});
