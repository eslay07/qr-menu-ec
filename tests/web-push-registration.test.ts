import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForPushRegistration } from '../app/ui/web-push-registration';

const fid = 'c' + 'A'.repeat(21);
void test('web registration waits for initiation and FID even when callback arrives synchronously', async () => {
  let unsubscribe = 0, resolveInitiation!: () => void, resolved = false;
  const promise = waitForPushRegistration({ subscribe(next) { next(fid); return () => { unsubscribe++; }; }, register: () => new Promise<void>(resolve => { resolveInitiation = resolve; }) });
  void promise.then(() => { resolved = true; });
  await Promise.resolve(); assert.equal(resolved, false); assert.equal(unsubscribe, 0);
  resolveInitiation(); assert.equal(await promise, fid); assert.equal(unsubscribe, 1);
});
void test('web registration accepts later callback and disposes once after success', async () => {
  let next!: (value: string) => void, unsubscribe = 0;
  const promise = waitForPushRegistration({ subscribe(callback) { next = callback; return () => { unsubscribe++; }; }, register: async () => {} });
  await Promise.resolve(); next(fid); assert.equal(await promise, fid); next('d' + 'B'.repeat(21)); assert.equal(unsubscribe, 1);
});
void test('synchronous invalid FID or observer error aborts before registration and disposes observer', async () => {
  for (const mode of ['invalid', 'error']) {
    let registrations = 0, unsubscribe = 0;
    await assert.rejects(waitForPushRegistration({ subscribe(next, error) { if (mode === 'invalid') next('legacy-token-is-not-a-fid'); else error(Error('observer failed')); return () => { unsubscribe++; }; }, register: async () => { registrations++; } }), mode === 'invalid' ? /inválido/ : /observer failed/);
    assert.equal(registrations, 0); assert.equal(unsubscribe, 1);
  }
});
void test('initiation failure cannot accept an earlier valid callback and cleans once', async () => {
  let unsubscribe = 0;
  await assert.rejects(waitForPushRegistration({ subscribe(next) { next(fid); return () => { unsubscribe++; }; }, register: async () => { throw Error('initiation failed'); } }), /initiation failed/);
  assert.equal(unsubscribe, 1);
});
void test('missing FID times out, unsubscribes and ignores a late callback', async () => {
  let next!: (value: string) => void, unsubscribe = 0;
  const promise = waitForPushRegistration({ subscribe(callback) { next = callback; return () => { unsubscribe++; }; }, register: async () => {} }, 5);
  await assert.rejects(promise, /No se recibió/); next(fid); assert.equal(unsubscribe, 1);
});
