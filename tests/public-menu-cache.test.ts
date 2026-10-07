import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicMenuCache } from '../lib/public-menu-cache';
import { blankCatalog, defaultSettings } from '../lib/contracts';
import type { Stored } from '../lib/store';
import { FirestoreRestaurantStore } from '../lib/firestore-store';
import type { FirestoreRest } from '../lib/firestore-rest';
const state = (id: string): Stored => ({ revision: 1, state: {
  schemaVersion: 1, restaurantId: id, ownerId: '', draft: structuredClone(blankCatalog),
  settings: structuredClone(defaultSettings), published: null, license: null,
  password: { salt: '', hash: '' }, recoveryHash: '', sessionEpoch: 0,
  failures: { count: 0, until: 0 }, createdAt: new Date().toISOString(),
} });
test('published cache deduplicates requests and isolates restaurants and caller mutations', async () => {
  const cache = new PublicMenuCache(); let reads = 0;
  const load = async () => { reads++; return state('a'); };
  const [first, second] = await Promise.all([cache.read('a', load), cache.read('a', load)]);
  assert.equal(reads, 1);
  first!.state.restaurantId = 'tampered';
  assert.equal(second!.state.restaurantId, 'a');
  assert.equal((await cache.read('a', load))!.state.restaurantId, 'a');
  assert.equal((await cache.read('b', async () => state('b')))!.state.restaurantId, 'b');
  cache.invalidate('a'); await cache.read('a', load); assert.equal(reads, 2);
});
test('cache rejects private snapshots and never caches errors', async () => {
  const cache = new PublicMenuCache(); const privateState = state('a');
  privateState.state.security = { emailCiphertext: 'secret' };
  await assert.rejects(cache.read('a', async () => privateState), /Private state/);
  await assert.rejects(cache.read('a', async () => { throw Error('quota'); }), /quota/);
  assert.equal((await cache.read('a', async () => state('a')))!.state.restaurantId, 'a');
});
test('session probes read two documents and never load catalogs', async () => {
  const paths: string[] = [];
  const db = { async get(path: string) { paths.push(path); return { data: path.endsWith('/auth') ? state('a').state : { revision: 1, createdAt: new Date().toISOString(), access: { active: true } } }; },
    async all() { throw Error('Session must not query a catalog'); } } as unknown as FirestoreRest;
  const store = new FirestoreRestaurantStore(db, 'a', { async mediaGet() { return null; }, async mediaPut() {} });
  const value = await store.readSession();
  assert.equal(paths.length, 2); assert.equal(value!.state.restaurantId, 'a'); assert.equal(value!.state.draft.dishes.length, 0);
});
test('public menu reads published version only and does not read private Auth or draft', async () => {
  const paths: string[] = [];
  const db = { async get(path: string) { paths.push(path); return { data: path.endsWith('/general') ? defaultSettings : path.includes('/catalogs/') ? blankCatalog : { revision: 1, createdAt: new Date().toISOString(), publishedCatalogId: 'published-one', draftCatalogId: 'draft-secret', published: { version: 1, at: new Date().toISOString() }, access: { active: true } } }; },
    async all(path: string) { paths.push(path); return path.endsWith('/categories') ? blankCatalog.categories.map((data, sortOrder) => ({ data: { ...data, sortOrder } })) : []; } } as unknown as FirestoreRest;
  const store = new FirestoreRestaurantStore(db, 'a', { async mediaGet() { return null; }, async mediaPut() {} });
  const value = await store.readMenu();
  assert.equal(value!.state.published!.version, 1);
  assert.equal(paths.some(path => path.includes('private/auth') || path.includes('draft-secret')), false);
  assert.equal(value!.state.security, undefined); assert.equal(value!.state.password.hash, '');
});
