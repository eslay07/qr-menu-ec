import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FirestoreRest } from '../lib/firestore-rest';
import { FirestoreBusinessRepository } from '../lib/firestore-business';
import { RestaurantPreferences } from '../lib/restaurant-preferences';
import { firestoreMaintenance } from '../lib/firestore-maintenance';
import type { AuthSecurity } from '../lib/auth-security';
import { FirestorePush, pushJob } from '../lib/firestore-push';
import { FcmSender } from '../lib/push-delivery';

const skip = !process.env.FIRESTORE_EMULATOR_HOST;
test('push queue isolates restaurants, retries, revokes logout and suppresses disabled preferences', { skip }, async () => {
  const db = new FirestoreRest('demo-qr-menu-ec', process.env.FIRESTORE_EMULATOR_HOST!);
  const rid = crypto.randomUUID(), other = crypto.randomUUID();
  const root = `restaurants/${rid}`;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const security = {
    async encrypt(text: string) { const iv = crypto.getRandomValues(new Uint8Array(12)); const bytes = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text)); return JSON.stringify({ iv: [...iv], bytes: [...new Uint8Array(bytes)] }); },
    async decrypt(cipher: string) { const data = JSON.parse(cipher); return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(data.iv) }, key, new Uint8Array(data.bytes))); },
  };
  await db.commit([{ path: root, data: { access: { active: true } } }, { path: `${root}/private/auth`, data: { sessionEpoch: 0 } }]);
  const push = new FirestorePush(db, rid, security), another = new FirestorePush(db, other, security);
  const token = `test_${crypto.randomUUID()}`;
  const device = await push.register({ token, platform: 'web' }, 0, 'session-one');
  const stored = await db.get(`${root}/pushDevices/${device.id}`);
  assert.ok(stored); assert.ok(!JSON.stringify(stored.data).includes(token));
  await another.revoke(token);
  assert.ok(await db.get(`${root}/pushDevices/${device.id}`));
  const now = new Date();
  await db.commit([pushJob(rid, 'first', 'newOrder', now)]);
  const due = await db.query('pushJobs', [{ field: 'nextAttemptAt', op: 'LESS_THAN_OR_EQUAL', value: now }], 1000, { allDescendants: true });
  assert.ok(due.some(row => row.path === `${root}/pushJobs/first`));
  let calls = 0;
  const sender = new FcmSender('demo-qr-menu-ec', async () => 'test', async () => { calls++; return calls === 1 ? Response.json({}, { status: 503 }) : Response.json({ name: 'sent' }); });
  await push.dispatch(sender, now);
  assert.equal((await db.get(`${root}/pushJobs/first`))?.data.attempt, 1);
  await push.dispatch(sender, new Date(now.getTime() + 61_000));
  assert.equal(calls, 2); assert.equal(await db.get(`${root}/pushJobs/first`), null);
  await db.commit([{ path: `${root}/settings/notifications`, data: { newOrder: false } }, pushJob(rid, 'disabled', 'newOrder', now)]);
  await push.dispatch(sender, now); assert.equal(calls, 2);
  await push.revokeSession('another-session'); assert.ok(await db.get(`${root}/pushDevices/${device.id}`));
  await push.revokeSession('session-one'); assert.equal(await db.get(`${root}/pushDevices/${device.id}`), null);
  await push.register({ token, platform: 'android' }, 0, 'session-two');
  await db.commit([{ path: root, data: { access: { active: true, plan: 'basic' } }, mask: ['access'] }, pushJob(rid, 'basic-plan', 'soldOut', now)]);
  await push.dispatch(sender, now); assert.equal(calls, 2);
  assert.equal(await db.get(`${root}/pushJobs/basic-plan`), null);
  await db.commit([{ path: root, data: { access: { active: false } }, mask: ['access'] }, pushJob(rid, 'suspended', 'soldOut', now)]);
  await push.dispatch(sender, now); assert.equal(calls, 2);
  assert.equal((await db.list(`${root}/pushDevices`)).documents.length, 0);
});
test('notification inbox pagination, scoped reads and revision conflicts', { skip }, async () => {
  const db = new FirestoreRest('demo-qr-menu-ec', process.env.FIRESTORE_EMULATOR_HOST!);
  const rid = crypto.randomUUID(), other = crypto.randomUUID();
  const business = new FirestoreBusinessRepository(db, rid);
  for (let i = 0; i < 32; i++) await business.notify({ id: `notice-${String(i).padStart(2, '0')}`, kind: 'order', title: 'Pedido', message: 'Prueba', createdAt: '2026-09-27T10:00:00.000Z', read: false });
  const first = await business.notifications();
  assert.equal(first.documents.length, 30);
  const second = await business.notifications(first.nextPageToken);
  assert.equal(second.documents.length, 2);
  assert.equal(new Set([...first.documents, ...second.documents].map(row => row.path)).size, 32);
  assert.equal(await new FirestoreBusinessRepository(db, other).markRead('notice-31'), false);
  assert.equal(await business.markRead('notice-31'), true);
  assert.equal((await db.get(`restaurants/${rid}/notifications/notice-31`))?.data.read, true);
  const preferences = new RestaurantPreferences(db, rid, {} as AuthSecurity);
  const initial = await preferences.notifications();
  await preferences.saveNotifications({ ...initial.settings, dailySummary: true }, initial.revision);
  await assert.rejects(preferences.saveNotifications(initial.settings, initial.revision));
  assert.equal((await preferences.notifications()).settings.dailySummary, true);
  await assert.rejects(business.notifications(btoa(JSON.stringify({ at: '2026-09-27T10:00:00.000Z', id: '../other' }))));
});

test('daily summary excludes cancelled/demo orders; inactivity is opt-in and deduplicated', { skip }, async () => {
  const db = new FirestoreRest('demo-qr-menu-ec', process.env.FIRESTORE_EMULATOR_HOST!);
  const rid = crypto.randomUUID(), disabled = crypto.randomUUID();
  const base = `restaurants/${rid}`;
  await db.commit([
    { path: base, data: { access: { active: true }, createdAt: new Date('2026-09-01') } },
    { path: `restaurants/${disabled}`, data: { access: { active: true }, createdAt: new Date('2026-09-01') } },
    { path: `${base}/settings/notifications`, data: { dailySummary: true, inactivity: true, inactivityHours: 8 } },
    ...Array.from({ length: 205 }, (_, index) => ({ path: `${base}/orders/order-${index}`, data: { demo: false, status: 'confirmed', totalCents: 100, createdAt: new Date('2026-09-26T12:00:00Z') } })),
    { path: `${base}/orders/demo`, data: { demo: true, status: 'confirmed', totalCents: 10000, createdAt: new Date('2026-09-26T12:00:00Z') } },
    { path: `${base}/orders/cancelled`, data: { demo: false, status: 'cancelled', totalCents: 10000, createdAt: new Date('2026-09-26T12:00:00Z') } },
  ]);
  const now = new Date('2026-09-27T16:00:00Z');
  await firestoreMaintenance(db, now);
  await firestoreMaintenance(db, now);
  const notices = (await new FirestoreBusinessRepository(db, rid).notifications()).documents;
  assert.equal(notices.length, 2);
  assert.match(notices.find(row => row.data.kind === 'daily_summary')!.data.message, /205 pedidos confirmados · USD 205.00/);
  assert.equal((await new FirestoreBusinessRepository(db, disabled).notifications()).documents.length, 0);
  // Test data no longer participates in subsequent maintenance runs.
  await db.commit([{ path: base, data: { access: { active: false } }, mask: ['access'] }]);
});
