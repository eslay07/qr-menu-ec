import test from 'node:test';
import assert from 'node:assert/strict';
import { scalarText } from '../lib/scalar-text';
import { cleanupResult } from '../scripts/cleanup-result.mjs';

void test('scalar conversion preserves primitives and explicit missing-value fallback', () => {
  for (const value of ['', 'fixture', 0, 15, false, true, BigInt(15)]) assert.equal(scalarText(value), String(value));
  assert.equal(scalarText(null), ''); assert.equal(scalarText(undefined, 'missing'), 'missing');
  for (const value of [{}, [], { toString: () => 'disguised object' }, () => 'function', Symbol('fixture')]) assert.throws(() => scalarText(value), TypeError);
});
void test('cleanup failure retains both original errors in their causal order', async () => {
  const primary = Error('primary task'), cleanup = Error('cleanup task');
  await assert.rejects(cleanupResult(primary, async () => { throw cleanup; }), error => {
    assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [primary, cleanup]); return true;
  });
  await assert.rejects(cleanupResult(undefined, async () => { throw cleanup; }), error => error === cleanup);
});
void test('successful safety cleanup leaves the caller original exception intact', async () => {
  const primary = Error('primary task'); let cleaned = false;
  const run = async () => { try { throw primary; } finally { await cleanupResult(primary, async () => { cleaned = true; }); } };
  await assert.rejects(run(), error => error === primary); assert.equal(cleaned, true);
});
