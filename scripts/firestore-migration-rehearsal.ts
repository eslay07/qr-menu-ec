import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { FirestoreRest } from '../lib/firestore-rest';
import { migrateBusinessToEmulator, importServerRowsToEmulator, importCreatorToEmulator } from '../lib/firestore-migration';
import type { State } from '../lib/store';
import type { OrderRecord } from '../lib/orders';

// Explicit local export only. Never obtains production data or credentials.
const Table = z.enum(['restaurant_hosts', 'platform_domain_config', 'audit_events', 'rate_limits', 'security_migrations', 'auth_sessions', 'owner_devices', 'auth_challenges']);
const Export = z.object({
  schemaVersion: z.literal(1),
  creator: z.object({ revision: z.number().int().nonnegative(), state: z.record(z.string(), z.unknown()) }).strict().nullable(),
  restaurants: z.array(z.object({ revision: z.number().int().nonnegative(), state: z.record(z.string(), z.unknown()) }).strict()).max(1000),
  orders: z.array(z.object({ order: z.record(z.string(), z.unknown()), tokenHash: z.string().min(1).max(256) }).strict()).max(10000),
  serverTables: z.array(z.object({ table: Table, rows: z.array(z.record(z.string(), z.unknown())).max(10000) }).strict()).default([]),
}).strict();

async function main() {
  const [filename, expectedChecksum, runId] = process.argv.slice(2);
  if (!filename || !/^[a-f0-9]{64}$/.test(expectedChecksum || '') || !runId || !z.string().uuid().safeParse(runId).success) throw Error('Uso: node --import tsx scripts/firestore-migration-rehearsal.ts ARCHIVO SHA256 RUN_UUID');
  const file = resolve(filename);
  if ((await stat(file)).size > 64_000_000) throw Error('Exportación demasiado grande para este ensayo.');
  const bytes = await readFile(file);
  console.log(JSON.stringify(await rehearseExport(bytes, expectedChecksum, runId)));
}

export async function rehearseExport(bytes: Uint8Array, expectedChecksum: string, runId: string) {
  const host = process.env.FIRESTORE_EMULATOR_HOST || '';
  if (!/^(localhost|127\.0\.0\.1):\d+$/.test(host)) throw Error('Solo se admite un emulador loopback.');
  z.string().uuid().parse(runId);
  if (bytes.byteLength > 64_000_000) throw Error('Exportación demasiado grande para este ensayo.');
  if (createHash('sha256').update(bytes).digest('hex') !== expectedChecksum) throw Error('El checksum no coincide.');
  const source = Export.parse(JSON.parse(new TextDecoder().decode(bytes)));
  for (const row of source.restaurants) z.string().uuid().parse(row.state.restaurantId);
  const ids = new Set(source.restaurants.map(row => row.state.restaurantId));
  if (ids.size !== source.restaurants.length || source.orders.some(row => !ids.has(row.order.restaurantId))) throw Error('Exportación con duplicados o pedidos fuera de ámbito.');
  const db = new FirestoreRest('demo-qr-menu-migration', host);
  const marker = `migrationRuns/${runId}`;
  const existing = await db.get(marker);
  if (existing && existing.data.sourceChecksum !== expectedChecksum) throw Error('No se puede reanudar con otro archivo.');
  if (!existing) await db.commit([{ path: marker, data: { source: 'read-only-export', sourceChecksum: expectedChecksum, status: 'running', startedAt: new Date() }, exists: false }]);
  const result = await migrateBusinessToEmulator(db, {
    async *restaurants() { for (const row of source.restaurants) yield { revision: row.revision, state: row.state as unknown as State }; },
    async *orders(restaurantId) { for (const row of source.orders) if (row.order.restaurantId === restaurantId) yield { order: row.order as unknown as OrderRecord, tokenHash: row.tokenHash }; },
  }, { async mediaGet() { throw Error('Las imágenes permanecen en D1; este ensayo no copia archivos.'); }, async mediaPut() { throw Error('Este ensayo no escribe imágenes.'); } }, runId);
  try {
    if (source.creator) await importCreatorToEmulator(db, source.creator);
    for (const group of source.serverTables) await importServerRowsToEmulator(db, group.table, group.rows);
    await db.commit([{ path: marker, data: { status: 'verified', sourceChecksum: expectedChecksum, serverTablesVerified: true }, mask: ['status', 'sourceChecksum', 'serverTablesVerified'] }]);
  } catch (error) {
    await db.commit([{ path: marker, data: { status: 'failed', serverTablesVerified: false }, mask: ['status', 'serverTablesVerified'] }]);
    throw error;
  }
  return { ...result, sourceChecksum: expectedChecksum, creatorCopied: !!source.creator, serverTables: source.serverTables.length, imagesCopied: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(() => {
  // Export errors may contain personal data. Keep the console free of payloads.
  console.error('Ensayo detenido sin sobrescribir diferencias. Revisa formato, checksum y marcador local; conserva el mismo RUN_UUID para reanudar.');
  process.exitCode = 1;
});
