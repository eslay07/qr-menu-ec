import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { FirestoreRest } from '../lib/firestore-rest';

// Restore only the preferences document created by this acceptance test.
// Never delete imported data, orders, sessions or another restaurant's settings.
if (!process.argv.includes('--restore-test-notifications')) throw Error('Explicit QA cleanup flag required');
const before = JSON.parse(await readFile('work/migration-preparation/preferences-evidence-before-save.json', 'utf8'));
if (before.notifications !== null) throw Error('Original preferences existed; this cleanup cannot delete them');
const require = createRequire(import.meta.url);
const project = 'qr-menu-6981a';
const auth = require('firebase-tools/lib/auth');
await require('firebase-tools/lib/requireAuth').requireAuth({ project, nonInteractive: true, ...auth.getProjectDefaultAccount(process.cwd()) });
const bearer = await require('firebase-tools/lib/apiv2').getAccessToken();
const db = new FirestoreRest(project, '', async () => bearer);
const path = 'restaurants/998d4980-a169-469f-b009-634a373ca7ad/settings/notifications';
const current = await db.get(path);
if (!current || !isDeepStrictEqual(current.data, { newOrder: false, customerCancelled: false, soldOut: false, dailySummary: true, inactivity: true, inactivityHours: 6 })) throw Error('Preferences differ from test values; refuse concurrent overwrite');
await db.commit([{ path, delete: true, updateTime: current.updateTime }]);
if (await db.get(path)) throw Error('Cleanup verification failed');
const result = { checkedAt: new Date().toISOString(), restoredOriginalAbsence: true, removedOnlyNewQaPreferences: true, importedDocumentsDeleted: 0, ordersTouched: 0, productionTrafficChanged: false };
await writeFile('work/migration-preparation/preferences-qa-cleanup.json', JSON.stringify(result, null, 2), { flag: 'wx' });
console.log(JSON.stringify(result, null, 2));
