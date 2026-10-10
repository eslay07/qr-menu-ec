import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseCompatibilityFlags } from '../scripts/release-runtime.mjs';

void test('runtime public fetch requires explicit opt-in and preserves existing compatibility flags', () => {
  const existing=['nodejs_compat','other_existing_flag'];
  assert.deepEqual(releaseCompatibilityFlags(existing, undefined), existing);
  assert.deepEqual(releaseCompatibilityFlags(existing, 'false'), existing);
  assert.deepEqual(releaseCompatibilityFlags(existing, 'true'), [...existing,'global_fetch_strictly_public']);
  assert.deepEqual(releaseCompatibilityFlags([...existing,'global_fetch_strictly_public'], 'true'), [...existing,'global_fetch_strictly_public']);
  assert.deepEqual(existing,['nodejs_compat','other_existing_flag']);
  assert.throws(()=>releaseCompatibilityFlags(existing, 'yes'), /Invalid public fetch/);
});
