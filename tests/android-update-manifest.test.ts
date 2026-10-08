import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { checkedAndroidRelease } from '../scripts/android-release.mjs';

const apk = Buffer.from('QA FICTICIO · bytes para validar metadatos');
const release = { versionCode: 15, versionName: '0.8.4', url: 'https://qr-menu-ec.consola.workers.dev/downloads/qr-menu-ec.apk', sha256: createHash('sha256').update(apk).digest('hex'), size: apk.length, certificateSha256: 'a'.repeat(64) };

void test('same-length APK tampering is rejected by checksum rather than only by size', () => {
  const altered = Buffer.from(apk);
  altered[0] ^= 1;
  assert.equal(altered.length, release.size);
  assert.throws(() => checkedAndroidRelease(release, altered), /binary does not match/);
});

void test('update metadata rejects deceptive URL variants and invalid numeric values before advertising a release', () => {
  for (const url of ['http://qr-menu-ec.consola.workers.dev/downloads/qr-menu-ec.apk', 'https://user@qr-menu-ec.consola.workers.dev/downloads/qr-menu-ec.apk', release.url + '#fragment', release.url.replace('.dev/', '.dev.evil.example/'), release.url.replace('.dev/', '.dev:443/')]) {
    assert.throws(() => checkedAndroidRelease({ ...release, url }, apk), /download URL/);
  }
  for (const versionCode of [Number.NaN, Number.POSITIVE_INFINITY, 15.5, '15', -1]) {
    assert.throws(() => checkedAndroidRelease({ ...release, versionCode }, apk), /version/);
  }
  for (const size of [Number.NaN, 0, -1, release.size + 0.5, String(release.size)]) {
    assert.throws(() => checkedAndroidRelease({ ...release, size }, apk), /integrity metadata/);
  }
});

void test('published update metadata contains only public integrity and version fields', () => {
  const result = checkedAndroidRelease({ ...release, privateNote: 'QA FICTICIO · no publicar', credentials: { token: 'synthetic' } }, apk);
  assert.deepEqual(result, release);
  assert.equal(Object.hasOwn(result, 'credentials'), false);
  assert.equal(Object.hasOwn(result, 'privateNote'), false);
});
