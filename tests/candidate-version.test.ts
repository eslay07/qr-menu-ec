import assert from 'node:assert/strict';
import test from 'node:test';
import { persistThenReadCandidate, readCreatedVersion, requireVerifiedCandidateIdentity } from '../scripts/candidate-version.mjs';

const miss = () => new Error('Cloudflare operation failed HTTP 404; codes 100146');
void test('candidate verification fails closed on identity or production traffic changes', () => {
  const before = [{ version_id: 'parent', percentage: 100 }];
  requireVerifiedCandidateIdentity('candidate', 'candidate', before, [{ version_id: 'parent', percentage: 100 }]);
  assert.throws(() => requireVerifiedCandidateIdentity('candidate', 'other', before, before), /identity mismatch/);
  assert.throws(() => requireVerifiedCandidateIdentity('candidate', 'candidate', before, [{ version_id: 'other', percentage: 100 }]), /Production changed/);
  assert.throws(() => requireVerifiedCandidateIdentity('candidate', 'candidate', before, [{ version_id: 'parent', percentage: 50 }]), /Production changed/);
});
void test('created version propagation retries only reads with bounded increasing delays', async () => {
  let calls = 0; const waits: number[] = [];
  const version = await readCreatedVersion(async () => { if (++calls < 3) throw miss(); return { id: 'existing-candidate' }; }, { wait: async (ms: number) => { waits.push(ms); } });
  assert.equal(version.id, 'existing-candidate'); assert.equal(calls, 3); assert.deepEqual(waits, [1000, 2000]);
});
void test('authorization, unrelated not-found, mixed codes and transport failures never retry', async () => {
  for (const error of [new Error('Cloudflare operation failed HTTP 401; codes 10000'), new Error('Cloudflare operation failed HTTP 404; codes 10090'), new Error('Cloudflare operation failed HTTP 404; codes 100146,10090'), new Error('fetch failed')]) {
    let calls = 0; let waits = 0;
    await assert.rejects(readCreatedVersion(async () => { calls++; throw error; }, { wait: async () => { waits++; } }), value => value === error);
    assert.equal(calls, 1); assert.equal(waits, 0);
  }
});
void test('exhaustion preserves the Cloudflare error after five reads and four waits', async () => {
  let calls = 0; const waits: number[] = []; const error = miss();
  await assert.rejects(readCreatedVersion(async () => { calls++; throw error; }, { wait: async (ms: number) => { waits.push(ms); } }), value => value === error);
  assert.equal(calls, 5); assert.deepEqual(waits, [1000, 2000, 3000, 4000]);
});
void test('candidate identity, parent and hashes are persisted before any verification read', async () => {
  const pending = { versionId: 'candidate', parentVersion: 'parent', workerSha256: 'worker', assetManifestSha256: 'assets', apkSha256: 'apk' };
  const events: string[] = []; let persisted: unknown;
  await assert.rejects(persistThenReadCandidate(pending, async (value: unknown) => { persisted = value; events.push('persist'); }, async () => { events.push('read'); assert.deepEqual(persisted, pending); throw miss(); }, { attempts: 1 }), { message: miss().message });
  assert.deepEqual(events, ['persist', 'read']); assert.deepEqual(persisted, pending);
});
void test('failed durable write prevents verification and leaves creation recovery to the operator', async () => {
  let reads = 0; const error = new Error('disk full');
  await assert.rejects(persistThenReadCandidate({}, async () => { throw error; }, async () => { reads++; }), value => value === error);
  assert.equal(reads, 0);
});
