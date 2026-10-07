import { verifiedBackup } from './verify-encrypted-backup.mjs';
import { rehearseExport } from './firestore-migration-rehearsal.ts';
import { FirestoreRest } from '../lib/firestore-rest.ts';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

// Local encrypted snapshot -> in-memory SQLite -> dedicated loopback emulator.
// No source download, plaintext export, production credentials or image upload.
const [directory, runId] = process.argv.slice(2);
const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!directory || !runId || !/^127\.0\.0\.1:\d+$/.test(host || '')) throw Error('Backup directory, run UUID and loopback emulator required.');
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.origin !== `http://${host}`) throw Error('Non-emulator network request blocked.');
  return nativeFetch(input, init);
};
let stage = 'backup-verification';
try {
  const { payload, receipt, verification } = await verifiedBackup(directory);
  const sql = new DatabaseSync(':memory:');
  let source;
  try {
    sql.exec(payload.sql);
    const serverNames = ['restaurant_hosts', 'platform_domain_config', 'audit_events', 'rate_limits', 'security_migrations', 'auth_sessions', 'owner_devices', 'auth_challenges'];
    const allowed = new Set(['application', 'orders', 'media', ...serverNames]);
    if (payload.inventory.some(row => !allowed.has(row.name))) throw Error('Unmapped source table.');
    const application = sql.prepare('SELECT id,revision,data FROM application ORDER BY id').all();
    const restaurants = application.filter(row => row.id !== '__creator__').map(row => {
      const state = JSON.parse(row.data);
      if (state.restaurantId !== row.id) throw Error('Unmapped application record.');
      return { revision: Number(row.revision), state };
    });
    const creator = application.find(row => row.id === '__creator__');
    const orders = sql.prepare('SELECT * FROM orders ORDER BY restaurant_id,id').all().map(value => ({
      tokenHash: String(value.public_token_hash),
      order: {
        id: String(value.id), restaurantId: String(value.restaurant_id), number: String(value.number),
        status: value.status, demo: Number(value.demo) === 1, alias: String(value.alias || ''),
        restaurantName: String(value.restaurant_name), menuVersion: Number(value.menu_version),
        currency: 'USD', totalCents: Number(value.total_cents), createdAt: String(value.created_at),
        publicExpiresAt: String(value.public_expires_at), cancelledAt: value.cancelled_at ? String(value.cancelled_at) : null,
        lines: JSON.parse(String(value.snapshot)),
      },
    }));
    source = { schemaVersion: 1, creator: creator ? { revision: Number(creator.revision), state: JSON.parse(creator.data) } : null,
      restaurants, orders, serverTables: serverNames.map(table => ({ table, rows: sql.prepare(`SELECT * FROM "${table}"`).all() })) };
  } finally { sql.close(); }
  const bytes = Buffer.from(JSON.stringify(source));
  const checksum = createHash('sha256').update(bytes).digest('hex');
  stage = 'initial-import';
  console.log(JSON.stringify({ stage, tablesVerified: verification.restoredTables, imagesVerified: verification.mediaVerified, restaurants: source.restaurants.length, orders: source.orders.length }));
  const first = await rehearseExport(bytes, checksum, runId);
  stage = 'resume-same-snapshot';
  console.log(JSON.stringify({ stage }));
  const second = await rehearseExport(bytes, checksum, runId);
  if (JSON.stringify(first) !== JSON.stringify(second)) throw Error('Resume results differ.');
  const db = new FirestoreRest('demo-qr-menu-migration', host);
  if ((await db.get(`migrationRuns/${runId}`))?.data.status !== 'verified') throw Error('Marker not verified.');
  for (const row of source.restaurants) {
    if ((await db.all(`restaurants/${row.state.restaurantId}/notifications`, 10000)).length) throw Error('Historical orders emitted notifications.');
  }
  const result = { completedAt: new Date().toISOString(), status: 'verified', ...first, resumeVerified: true,
    sqlSha256: receipt.sqlSha256, archiveSha256: receipt.archiveSha256,
    imagesVerified: verification.mediaVerified, imagesRemainIn: 'D1', r2: 'not applicable: confirmed by operator',
    serverRows: source.serverTables.map(group => ({ table: group.table, rows: group.rows.length })),
    historicalNotificationsEmitted: 0, project: 'demo-qr-menu-migration', productionModified: false };
  await writeFile(join(resolve(directory), `migration-${runId}.json`), JSON.stringify(result, null, 2), { flag: 'wx' });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  // Do not output exception payloads: source data and Firestore errors may contain PII.
  console.error(JSON.stringify({ status: 'failed', stage, runId, errorType: error?.constructor?.name, productionModified: false }));
  process.exitCode = 1;
}
