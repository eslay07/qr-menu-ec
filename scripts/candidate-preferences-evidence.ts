import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { FirestoreRest } from '../lib/firestore-rest';
import { FirestoreDomainRepository } from '../lib/firestore-domains';

// Read only the two preferences documents. Never print encrypted secrets or PII.
const require = createRequire(import.meta.url);
const project = 'qr-menu-6981a';
const auth = require('firebase-tools/lib/auth');
await require('firebase-tools/lib/requireAuth').requireAuth({ project, nonInteractive: true, ...auth.getProjectDefaultAccount(process.cwd()) });
const bearer = await require('firebase-tools/lib/apiv2').getAccessToken();
const transport = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  const method = init?.method || 'GET';
  if (url.hostname !== 'firestore.googleapis.com' || !(method === 'GET' || method === 'POST' && url.pathname.endsWith(':runQuery'))) throw Error('Read-only evidence guard blocked operation');
  return transport.call(globalThis, input, init);
};
const db = new FirestoreRest(project, '', async () => bearer);
const path = 'restaurants/998d4980-a169-469f-b009-634a373ca7ad/settings';
const [notifications, general] = await Promise.all([db.get(`${path}/notifications`), db.get(`${path}/general`)]);
const hostnames = await db.list('hostnames', 100);
const domainRepository = new FirestoreDomainRepository(db);
const primary = await domainRepository.primary('998d4980-a169-469f-b009-634a373ca7ad');
const result = {
  checkedAt: new Date().toISOString(), remoteWrites: 0,
  notifications: notifications?.data ?? null,
  primaryHostname: primary?.hostname ?? null,
  hostnames: hostnames.documents.filter(row => row.data.restaurantId === '998d4980-a169-469f-b009-634a373ca7ad' || row.data.restaurant_id === '998d4980-a169-469f-b009-634a373ca7ad').map(row => ({ path: row.path, hostname: row.data.hostname, kind: row.data.kind, status: row.data.status, sslStatus: row.data.sslStatus, priority: row.data.priority })),
  wifi: {
    documentExists: !!general, enabled: general?.data.wifiEnabled === true,
    namePresent: typeof general?.data.wifiName === 'string' && !!general.data.wifiName,
    encryptedPasswordPresent: typeof general?.data.wifiCiphertext === 'string' && !!general.data.wifiCiphertext,
    ciphertextVersionCorrect: typeof general?.data.wifiCiphertext === 'string' && general.data.wifiCiphertext.startsWith('v1.'),
    testPasswordNotInDocument: !JSON.stringify(general?.data || {}).includes('qa-wifi-2026'),
    plaintextPasswordFieldPresent: Object.keys(general?.data || {}).some(key => /password|wifiKey/i.test(key)),
  },
};
const label = process.argv[2] || 'current';
if (!/^[a-z0-9-]{1,40}$/.test(label)) throw Error('Invalid evidence label');
await writeFile(`work/migration-preparation/preferences-evidence-${label}.json`, JSON.stringify(result, null, 2), { flag: 'wx' });
console.log(JSON.stringify(result, null, 2));
