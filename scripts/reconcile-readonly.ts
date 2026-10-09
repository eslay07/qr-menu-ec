import { readFile, writeFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { verifiedBackup } from './verify-encrypted-backup.mjs';
import { FirestoreRest } from '../lib/firestore-rest';
import { canonicalWire, validateManifest, type MigrationManifest } from '../lib/firestore-remote-migration';
const require = createRequire(import.meta.url);
const [baseline, current, manifestFile, checksum, output] = process.argv.slice(2);
if (!output) throw Error('Expected baseline backup, current backup, encrypted manifest, checksum, report path');
const old = await verifiedBackup(baseline);
const fresh = await verifiedBackup(current);
// An unchanged verified source needs no remapping. Refuse to infer counts if it changed.
if (old.receipt.sqlSha256 !== fresh.receipt.sqlSha256 || old.receipt.inventorySha256 !== fresh.receipt.inventorySha256) throw Error('D1 changed: rebuild an isolated manifest before counting document changes');
const encrypted = Buffer.from(await readFile(manifestFile));
const plain = Buffer.from(execFileSync('powershell.exe', ['-NoProfile','-NonInteractive','-Command', 'Add-Type -AssemblyName System.Security; $reconcileBytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); [Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($reconcileBytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))'], { input: encrypted.toString('base64'), encoding:'utf8', stdio:['pipe','pipe','pipe'], maxBuffer:100_000_000 }), 'base64');
let plan: MigrationManifest;
try { plan = JSON.parse(plain.toString()); } finally { plain.fill(0); }
await validateManifest(plan, checksum);
const auth = require('firebase-tools/lib/auth');
await require('firebase-tools/lib/requireAuth').requireAuth({project:plan.project,nonInteractive:true,...auth.getProjectDefaultAccount(process.cwd())});
const { getAccessToken } = require('firebase-tools/lib/apiv2');
const bearer = await getAccessToken();
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (url.hostname !== 'firestore.googleapis.com' || !(method === 'GET' || method === 'POST' && url.pathname.endsWith(':listCollectionIds'))) throw Error('Read-only reconciliation blocked network operation');
  return originalFetch(input, init);
};
const db = new FirestoreRest(plan.project, '', async () => bearer);
const inventory = await db.inventoryWire();
const actual = new Map(inventory.map(d => [d.path,d]));
const expected = new Set(plan.documents.map(d => d.path));
let missing = 0, changed = 0;
for (const d of plan.documents) {
  const found = actual.get(d.path);
  if (!found) missing++;
  else if (canonicalWire(found.fields) !== canonicalWire(d.fields)) changed++;
}
const unexpected = inventory.filter(d => !expected.has(d.path) && d.path !== `migrationRuns/${plan.runId}` && !d.path.startsWith(`migrationRuns/${plan.runId}/`));
const result = { checkedAt: new Date().toISOString(), sourceSnapshotAt:fresh.receipt.createdAt, sqlSha256:fresh.receipt.sqlSha256, d1Changed:false, tables: fresh.payload.inventory.map((t:{name:string;count:number}) => ({table:t.name,rows:t.count,changed:false})), expectedDataDocuments:plan.documents.length, remoteTotalDocuments:inventory.length, missingDocuments:missing, changedDocuments:changed, unexpectedDocuments:unexpected.length, requiredCreates:missing, requiredUpdates:changed, remoteWrites:0, unchanged:missing===0 && changed===0 && unexpected.length===0, warning:'Point-in-time snapshot; repeat under the final write freeze.' };
await writeFile(output,JSON.stringify(result,null,2),{flag:'wx'});
console.log(JSON.stringify(result,null,2));
