import { z } from 'zod';
import { digest } from './security';
import { FirestoreRest, encodeFirestoreFields, firestoreHashId, type TransferDocument } from './firestore-rest';

export function canonicalWire(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalWire).join(',')}]`;
  // Firestore serializes an exact whole-second Timestamp without .000.
  // Strip only insignificant fractional zeros, never truncate real precision.
  if (value && typeof value === 'object' && Object.keys(value).length === 1 && 'timestampValue' in value && typeof value.timestampValue === 'string') {
    const stamp = value.timestampValue.replace(/\.([0-9]+)Z$/, (_match, digits: string) => { const fraction = digits.replace(/0+$/, ''); return fraction ? `.${fraction}Z` : 'Z'; });
    return JSON.stringify({ timestampValue: stamp });
  }
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${canonicalWire(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
const valueSchema: z.ZodType = z.lazy(() => z.union([
  z.object({ nullValue: z.null() }).strict(), z.object({ booleanValue: z.boolean() }).strict(),
  z.object({ integerValue: z.string().regex(/^-?\d+$/) }).strict(), z.object({ doubleValue: z.number().finite() }).strict(),
  z.object({ stringValue: z.string() }).strict(), z.object({ timestampValue: z.string().datetime({ offset: true }) }).strict(),
  z.object({ arrayValue: z.object({ values: z.array(valueSchema).optional() }).strict() }).strict(),
  z.object({ mapValue: z.object({ fields: z.record(z.string(), valueSchema).optional() }).strict() }).strict(),
]));
const manifestSchema = z.object({ version: z.literal(1), project: z.literal('qr-menu-6981a'), database: z.literal('(default)'),
  runId: z.string().uuid(), sourceChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  documents: z.array(z.object({ path: z.string(), fields: z.record(z.string(), valueSchema) }).strict()).min(1).max(100000),
}).strict();
export type MigrationManifest = { version: 1; project: 'qr-menu-6981a'; database: '(default)'; runId: string; sourceChecksum: string; documents: TransferDocument[] };
const roots = new Set(['restaurants','users','publicMenus','platformConfig','hostnames','auditEvents','rateLimits','securityChallenges','migrationRuns']);
export async function validateManifest(input: MigrationManifest, checksum: string) {
  manifestSchema.parse(input);
  const seen = new Set<string>();
  for (const d of input.documents) {
    const parts = d.path.split('/');
    if (parts.length % 2 || !roots.has(parts[0]) || parts.some(p => !p || p === '.' || p === '..' || /[\\?#%\u0000-\u001f]/.test(p)) || seen.has(d.path) || d.path.startsWith(`migrationRuns/${input.runId}`)) throw Error('Invalid or duplicate manifest path.');
    seen.add(d.path);
  }
  if (await digest(canonicalWire(input)) !== checksum) throw Error('Manifest checksum mismatch.');
}
export async function makeManifest(db: FirestoreRest, runId: string, sourceChecksum: string): Promise<MigrationManifest> {
  if (!db.isEmulator) throw Error('Manifest preparation requires isolated emulator.');
  z.string().uuid().parse(runId);
  const rows = await db.inventoryWire();
  const phase = (path: string) => path === 'platformConfig/creator' ? 0
    : /\/orders\/|^platformConfig\/orderTokens\//.test(path) ? 3
    : /\/catalogs\/|^publicMenus\//.test(path) ? 2
    : /^(restaurants|users)\/|^platformConfig\/ownerEmails\//.test(path) ? 1
    : /^hostnames\/|^platformConfig\/(domains|hostnameKinds)/.test(path) ? 4
    : /^(auditEvents|migrationRuns)\//.test(path) ? 6 : 5;
  const documents = rows.filter(d => d.path !== `migrationRuns/${runId}` && !d.path.startsWith(`migrationRuns/${runId}/`)).map(({path,fields}) => ({path,fields})).sort((a,b) => phase(a.path)-phase(b.path) || a.path.localeCompare(b.path));
  const plan: MigrationManifest = { version: 1, project: 'qr-menu-6981a', database: '(default)', runId, sourceChecksum, documents };
  await validateManifest(plan, await digest(canonicalWire(plan)));
  return plan;
}
type Controls = { authorizeWrites: () => Promise<void>; afterBatch?: (completed: number) => Promise<void>; onStage?: (stage: string) => void };
function verifyTarget(db: FirestoreRest) {
  if (!db.isEmulator && db.root !== 'projects/qr-menu-6981a/databases/(default)/documents') throw Error('Unauthorized migration destination.');
}
export async function importRemoteManifest(db: FirestoreRest, plan: MigrationManifest, checksum: string, controls: Controls) {
  controls.onStage?.('import.validate-target-and-manifest');
  verifyTarget(db); await validateManifest(plan, checksum); await controls.authorizeWrites();
  const run = `migrationRuns/${plan.runId}`;
  controls.onStage?.('import.read-checkpoint');
  let marker = await db.get(run);
  controls.onStage?.('import.inventory-destination');
  const inventory = await db.inventoryWire();
  if (!marker && inventory.length) throw Error('Destination is not empty; no writes performed.');
  if (marker && (marker.data.checksum !== checksum || marker.data.sourceChecksum !== plan.sourceChecksum || !['running','verified'].includes(String(marker.data.status)))) throw Error('Incompatible migration checkpoint.');
  const expected = new Map(plan.documents.map(d => [d.path,d]));
  const entries = new Map<string, string>();
  for (const d of plan.documents) entries.set(`${run}/documents/${firestoreHashId(await digest(d.path))}`, d.path);
  for (const d of inventory) {
    if (d.path !== run && !expected.has(d.path) && !entries.has(d.path)) throw Error('Unexpected destination document; stopped without overwriting.');
  }
  if (!marker) {
    controls.onStage?.('import.authorize-first-write');
    await controls.authorizeWrites();
    controls.onStage?.('import.create-checkpoint');
    await db.commit([{ path: run, data: { checksum, sourceChecksum: plan.sourceChecksum, status: 'running', total: plan.documents.length }, exists: false }]);
    marker = await db.get(run);
  }
  let completed = 0;
  // Bounded atomic batches: data and its per-document journal are committed together.
  for (let offset = 0; offset < plan.documents.length; offset += 40) {
    controls.onStage?.('import.authorize-batch');
    await controls.authorizeWrites();
    controls.onStage?.('import.read-batch-and-journal');
    const writes: Parameters<FirestoreRest['commitWire']>[0] = [];
    for (const d of plan.documents.slice(offset, offset + 40)) {
      const path = `${run}/documents/${firestoreHashId(await digest(d.path))}`;
      const checksumDocument = await digest(canonicalWire(d.fields));
      const [existing, journal] = await Promise.all([db.getWire(d.path), db.get(path)]);
      if (existing || journal) {
        if (!existing || !journal || journal.data.path !== d.path || journal.data.checksum !== checksumDocument || await digest(canonicalWire(existing.fields)) !== checksumDocument) throw Error('Destination changed or journal missing.');
      } else {
        writes.push({ path: d.path, fields: d.fields, exists: false }, { path, fields: encodeFirestoreFields({ path: d.path, checksum: checksumDocument }), exists: false });
      }
    }
    controls.onStage?.('import.commit-batch');
    if (writes.length) await db.commitWire(writes);
    completed = Math.min(offset + 40, plan.documents.length);
    await controls.afterBatch?.(completed);
  }
  controls.onStage?.('import.verify-complete-inventory');
  const final = await db.inventoryWire();
  if (final.length !== 1 + 2 * expected.size) throw Error('Final inventory differs.');
  for (const d of final) {
    if (d.path === run) continue;
    const source = expected.get(d.path);
    if (source) { if (canonicalWire(source.fields) !== canonicalWire(d.fields)) throw Error('Final document differs.'); }
    else {
      const path = entries.get(d.path);
      if (!path || canonicalWire(d.fields) !== canonicalWire(encodeFirestoreFields({ path, checksum: await digest(canonicalWire(expected.get(path)!.fields)) }))) throw Error('Unexpected or modified final journal.');
    }
  }
  controls.onStage?.('import.authorize-completion');
  await controls.authorizeWrites();
  const current = await db.get(run);
  controls.onStage?.('import.mark-verified');
  await db.commit([{ path: run, data: { ...current!.data, status: 'verified', completed }, updateTime: current!.updateTime }]);
  return { runId: plan.runId, checksum, documentsVerified: expected.size, status: 'verified' };
}
export async function rollbackRemoteManifest(db: FirestoreRest, plan: MigrationManifest, checksum: string, controls: Controls) {
  verifyTarget(db); await validateManifest(plan, checksum); await controls.authorizeWrites();
  const run = `migrationRuns/${plan.runId}`;
  const marker = await db.get(run);
  if (!marker || marker.data.checksum !== checksum || !['running','verified','rolling-back'].includes(String(marker.data.status))) throw Error('Rollback not owned by this run.');
  const pairs: Array<{ document: TransferDocument; journal: TransferDocument }> = [];
  const allowed = new Set([run]);
  for (const d of plan.documents) {
    const journalPath = `${run}/documents/${firestoreHashId(await digest(d.path))}`;
    allowed.add(d.path); allowed.add(journalPath);
    const [document, journal] = await Promise.all([db.getWire(d.path),db.getWire(journalPath)]);
    if (!document && !journal) continue;
    const expectedJournal = encodeFirestoreFields({ path: d.path, checksum: await digest(canonicalWire(d.fields)) });
    if (!document || !journal || canonicalWire(document.fields) !== canonicalWire(d.fields) || canonicalWire(journal.fields) !== canonicalWire(expectedJournal)) throw Error('Changed document; rollback refused.');
    pairs.push({ document, journal });
  }
  if ((await db.inventoryWire()).some(d => !allowed.has(d.path))) throw Error('Unowned data; rollback refused.');
  await controls.authorizeWrites();
  await db.commit([{ path: run, data: { ...marker.data, status: 'rolling-back' }, updateTime: marker.updateTime }]);
  for (let offset = 0; offset < pairs.length; offset += 40) {
    await controls.authorizeWrites();
    await db.commitWire(pairs.slice(offset,offset+40).flatMap(pair => [pair.document,pair.journal].map(d => ({ path:d.path, delete:true, updateTime:d.updateTime }))));
    await controls.afterBatch?.(Math.min(offset+40,pairs.length));
  }
  const final = await db.get(run);
  await controls.authorizeWrites();
  await db.commit([{ path:run, data: { ...final!.data,status:'rolled-back' },updateTime:final!.updateTime }]);
  return { documentsRemoved: pairs.length, runId:plan.runId, status:'rolled-back' };
}
