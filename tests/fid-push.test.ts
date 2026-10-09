import test from 'node:test';
import assert from 'node:assert/strict';
import { createD1Fixture } from './d1-fixture';
import { FirestoreRest, firestoreHashId } from '../lib/firestore-rest';
import { FirestorePush, pushJob } from '../lib/firestore-push';
import { FcmSender } from '../lib/push-delivery';
import { jsonRequestBody } from './http-fixture';

for (const provider of ['d1', 'firestore'] as const) {
  void test(`${provider} FID migration is atomic, preserves Android and other session families, and revokes its own family`, { skip: provider === 'firestore' && !process.env.FIRESTORE_EMULATOR_HOST }, async t => {
    const fixture = provider === 'd1' ? createD1Fixture() : null;
    const db = fixture?.db || new FirestoreRest('demo-qr-menu-ec', process.env.FIRESTORE_EMULATOR_HOST!);
    const rid = crypto.randomUUID(), root = `restaurants/${rid}`, now = new Date();
    const families = [{ hash: 'a'.repeat(64), csrf: crypto.randomUUID() }, { hash: 'b'.repeat(64), csrf: crypto.randomUUID() }];
    const security = { encrypt: async (value: string) => Buffer.from(value).toString('base64'), decrypt: async (value: string) => Buffer.from(value, 'base64').toString() };
    try {
      await db.commit([{ path: root, data: { access: { active: true, plan: 'premium' } } }, { path: `${root}/private/auth`, data: { sessionEpoch: 0 } }, ...families.map(family => ({ path: 'platformConfig/sessionGrants/entries/' + firestoreHashId(family.hash), data: { idHash: family.hash, scope: 'owner', restaurantId: rid, csrfToken: family.csrf, revokedAt: null, createdAt: now, lastSeenAt: now, idleExpiresAt: new Date(now.getTime() + 60_000), absoluteExpiresAt: new Date(now.getTime() + 3600_000) } }))]);
      const push = new FirestorePush(db, rid, security);
      const legacy = await push.register({ token: 'legacy-web-token-for-family-a', platform: 'web' }, 0, families[0].csrf);
      const android = await push.register({ token: 'android-token-for-family-a', platform: 'android' }, 0, families[0].csrf);
      const other = await push.register({ token: 'other-web-token-for-family-b', platform: 'web' }, 0, families[1].csrf);
      const before = (await db.list(`${root}/pushDevices`, 20)).documents;
      await assert.rejects(push.register({ token: 'invalid-fid-format-123456', platform: 'web', targetType: 'fid', registrationKey: crypto.randomUUID() }, 0, families[0].csrf));
      assert.deepEqual((await db.list(`${root}/pushDevices`, 20)).documents, before, 'invalid migration cannot remove existing subscriptions');
      const commit = db.commit.bind(db);
      const failed = t.mock.method(db, 'commit', async () => { throw Error('simulated atomic write failure'); });
      await assert.rejects(push.register({ token: 'c' + 'A'.repeat(21), platform: 'web', targetType: 'fid', registrationKey: crypto.randomUUID() }, 0, families[0].csrf), /atomic write failure/);
      failed.mock.restore();
      assert.deepEqual((await db.list(`${root}/pushDevices`, 20)).documents, before);
      const key = crypto.randomUUID();
      const first = await push.register({ token: 'c' + 'A'.repeat(21), platform: 'web', targetType: 'fid', registrationKey: key }, 0, families[0].csrf);
      assert.equal(await db.get(`${root}/pushDevices/${legacy.id}`), null);
      assert.ok(await db.get(`${root}/pushDevices/${android.id}`));
      assert.ok(await db.get(`${root}/pushDevices/${other.id}`));
      const second = await push.register({ token: 'd' + 'B'.repeat(21), platform: 'web', targetType: 'fid', registrationKey: key }, 0, families[0].csrf);
      assert.equal(await db.get(`${root}/pushDevices/${first.id}`), null);
      const stored = await db.get(`${root}/pushDevices/${second.id}`); assert.ok(stored);
      assert.equal(stored.data.targetType, 'fid');
      assert.ok(!JSON.stringify(stored.data).includes('d' + 'B'.repeat(21)), 'FID is encrypted at rest');
      const sent: { token?: string; fid?: string }[] = [];
      const sender = new FcmSender('demo-qr-menu-ec', async () => 'test-only', async (_url, init) => { sent.push(jsonRequestBody<{ message: { token?: string; fid?: string } }>(init?.body).message); return Response.json({ name: 'fixture-message' }); });
      const dispatchAt = new Date(Date.now() + 1000);
      await commit([pushJob(rid, 'fid-migration', 'newOrder', dispatchAt)]);
      await push.dispatch(sender, dispatchAt);
      assert.equal(sent.length, 3);
      assert.deepEqual(sent.filter(message => message.fid).map(message => ({ fid: message.fid, token: message.token })), [{ fid: 'd' + 'B'.repeat(21), token: undefined }]);
      assert.deepEqual(new Set(sent.filter(message => message.token).map(message => message.token)), new Set(['android-token-for-family-a', 'other-web-token-for-family-b']));
      await push.revokeSessionFamily(families[0].hash);
      assert.equal(await db.get(`${root}/pushDevices/${second.id}`), null);
      assert.equal(await db.get(`${root}/pushDevices/${android.id}`), null);
      assert.ok(await db.get(`${root}/pushDevices/${other.id}`));
    } finally { fixture?.sqlite.close(); }
  });
}
