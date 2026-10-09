import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseManifest, verifyMailDns } from '../scripts/verify-mail-dns';

const manifest = { domain: 'example.com', records: [
  { purpose: 'spf', name: 'send.example.com', type: 'TXT', value: 'v=spf1 include:amazonses.com ~all' },
  { purpose: 'dkim', name: 'resend._domainkey.example.com', type: 'TXT', value: 'p=public-test-key' },
] };
const dns = {
  resolveTxt: async (name: string) => name.startsWith('send.') ? [['v=spf1 include:amazonses.com ', '~all']] : [['p=public-', 'test-key']],
  resolveCname: async () => ['target.example.net.'],
  resolveMx: async () => [{ exchange: 'feedback.example.net.', priority: 10 }],
};

void test('mail DNS joins TXT chunks and compares exact provider records without sending mail', async () => {
  const result = await verifyMailDns(manifest, dns);
  assert.equal(result.ok, true);
  assert.equal(JSON.stringify(result).includes('public-test-key'), false);
});
void test('mail DNS fails closed on duplicate SPF, mismatch and unavailable DNS', async () => {
  assert.equal((await verifyMailDns(manifest, { ...dns, resolveTxt: async () => [['v=spf1 include:amazonses.com ~all'], ['v=spf1 -all']] })).ok, false);
  assert.equal((await verifyMailDns(manifest, { ...dns, resolveTxt: async () => [['wrong']] })).ok, false);
  assert.equal((await verifyMailDns(manifest, { ...dns, resolveTxt: async () => { throw Object.assign(new Error('Unavailable'), { code: 'ETIMEOUT' }); } })).ok, false);
});
void test('mail DNS rejects missing DKIM and unrelated hostnames before any lookup', () => {
  assert.throws(() => parseManifest({ ...manifest, records: [manifest.records[0]] }));
  assert.throws(() => parseManifest({ ...manifest, records: [manifest.records[0], { ...manifest.records[1], name: 'resend._domainkey.other.com' }] }));
  assert.throws(() => parseManifest({ ...manifest, apiKey: 'not-allowed' }));
});
void test('mail DNS supports provider CNAME DKIM and exact MX priority', async () => {
  const input = { ...manifest, records: [manifest.records[0], { ...manifest.records[1], type: 'CNAME', value: 'target.example.net' }, { purpose: 'mx', type: 'MX', name: 'send.example.com', value: 'feedback.example.net', priority: 10 }] };
  assert.equal((await verifyMailDns(input, dns)).ok, true);
  assert.equal((await verifyMailDns(input, { ...dns, resolveMx: async () => [{ exchange: 'feedback.example.net', priority: 20 }] })).ok, false);
});
