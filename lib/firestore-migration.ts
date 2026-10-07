import { FirestoreRest, firestoreId, firestoreHashId, type FirestoreWrite } from './firestore-rest';
import { digest } from './security';
import { FirestoreRestaurantStore } from './firestore-store';
import { FirestoreOrderStore } from './firestore-orders';
import type { State, Store } from './store';
import type { OrderRecord } from './orders';
import { normalizeCatalog, normalizeSettings } from './contracts';

// A read-only D1 source is intentionally injected, not discovered. No command
// in this module exports production, grants IAM, or changes the source DB.
export interface MigrationSource {
  restaurants(): AsyncIterable<{ revision: number; state: State }>;
  orders(restaurantId: string): AsyncIterable<{ order: OrderRecord; tokenHash: string }>;
}
export async function migrateBusinessToEmulator(db: FirestoreRest, source: MigrationSource, media: Pick<Store, 'mediaGet' | 'mediaPut'>, resumeRunId?: string) {
  if (!db.isEmulator) throw Error('El ensayo de migración solo admite emulador.');
  const runId = resumeRunId ? firestoreId(resumeRunId) : crypto.randomUUID();
  const path = `migrationRuns/${runId}`;
  const prior = await db.get(path);
  if (!prior) await db.commit([{ path, data: { status: 'running', startedAt: new Date(), source: 'read-only-export', restaurants: 0, orders: 0 }, exists: false }]);
  else if (prior.data.source !== 'read-only-export') throw Error('Ejecución incompatible.');
  let restaurants = 0, orders = 0;
  const seenRestaurants = new Set<string>();
  try {
    for await (const sourceRow of source.restaurants()) {
      const state = sourceRow.state;
      if (seenRestaurants.has(state.restaurantId)) throw Error('Restaurante duplicado en origen.');
      seenRestaurants.add(state.restaurantId);
      const repository = new FirestoreRestaurantStore(db, state.restaurantId, media);
      if (!Number.isSafeInteger(sourceRow.revision) || sourceRow.revision < 0) throw Error('Revisión inválida.');
      const checkpoint = `${path}/restaurants/${firestoreId(state.restaurantId)}`;
      const sourceHash = await digest(JSON.stringify(sourceRow));
      const marker = await db.get(checkpoint);
      const existing = await repository.read();
      if (existing) {
        if (!marker || marker.data.sourceHash !== sourceHash || existing.revision !== sourceRow.revision) throw Error('Origen o destino modificado; no se sobrescribirá.');
      } else {
        if (marker) throw Error('Falta un restaurante previamente migrado.');
        if (!await repository.commit(state, null, [
          { path: repository.path, data: { revision: sourceRow.revision }, mask: ['revision'] },
          { path: checkpoint, data: { sourceHash }, exists: false },
        ])) throw Error('Conflicto al migrar el restaurante.');
      }
      const target = await repository.read();
      const expectedState = { ...state, draft: normalizeCatalog(state.draft), settings: normalizeSettings(state.settings), access: { active: true, features: [], maxDishes: 150, sampleMenuEnabled: false, ...state.access }, published: state.published ? { ...state.published, catalog: normalizeCatalog(state.published.catalog) } : null };
      if (!target || target.revision !== sourceRow.revision || canonical(target.state) !== canonical(expectedState)) throw Error('No coincide la verificación del restaurante completo.');
      const orderStore = new FirestoreOrderStore(db);
      const seenOrders = new Set<string>();
      for await (const item of source.orders(state.restaurantId)) {
        if (seenOrders.has(item.order.id)) throw Error('Pedido duplicado en origen.');
        seenOrders.add(item.order.id);
        if (item.order.restaurantId !== state.restaurantId) throw Error('Pedido fuera del restaurante de origen.');
        const current = await orderStore.read(state.restaurantId, item.order.id);
        if (!current) await orderStore.create(item.order, item.tokenHash, false);
        const token = await db.get(`platformConfig/orderTokens/entries/${firestoreHashId(item.tokenHash)}`);
        if (token?.data.restaurantId !== state.restaurantId || token.data.orderId !== item.order.id) throw Error('Índice del pedido incompatible.');
        if (JSON.stringify(await orderStore.read(state.restaurantId, item.order.id)) !== JSON.stringify(item.order)) throw Error('No coincide la verificación del pedido.');
        orders++;
      }
      const persistedOrders = await db.all(`${repository.path}/orders`, 10000);
      if (persistedOrders.length !== seenOrders.size || persistedOrders.some(row => !seenOrders.has(row.path.split('/').pop()!))) throw Error('El inventario de pedidos no coincide; no se borrará ningún pedido.');
      restaurants++;
      await db.commit([{ path, data: { restaurants, orders }, mask: ['restaurants', 'orders'] }]);
    }
    const checkpoints = await db.all(`${path}/restaurants`, 10000);
    if (checkpoints.length !== seenRestaurants.size) throw Error('El inventario de restaurantes cambió al reanudar.');
    await db.commit([{ path, data: { status: 'verified', completedAt: new Date(), restaurants, orders }, mask: ['status', 'completedAt', 'restaurants', 'orders'] }]);
    return { runId, restaurants, orders };
  } catch (error) {
    await db.commit([{ path, data: { status: 'failed', completedAt: new Date(), restaurants, orders }, mask: ['status', 'completedAt', 'restaurants', 'orders'] }]);
    throw new Error(`Migración interrumpida; reanudar con runId=${runId}.`, { cause: error });
  }
}

type ServerTable = 'restaurant_hosts' | 'platform_domain_config' | 'audit_events' | 'rate_limits' | 'security_migrations' | 'auth_sessions' | 'owner_devices' | 'auth_challenges';
function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export async function importCreatorToEmulator(db: FirestoreRest, creator: { revision: number; state: Record<string, unknown> }) {
  if (!db.isEmulator) throw Error('El ensayo de migración solo admite emulador.');
  if (!Number.isSafeInteger(creator.revision) || creator.revision < 0) throw Error('Revisión inválida.');
  const path = 'platformConfig/creator';
  const existing = await db.get(path);
  if (existing && canonical(existing.data) !== canonical(creator)) throw Error('Creador modificado; no se sobrescribirá.');
  if (!existing) await db.commit([{ path, data: creator, exists: false }]);
  if (canonical((await db.get(path))?.data) !== canonical(creator)) throw Error('No coincide el registro privado del creador.');
}
export async function importServerRowsToEmulator(db: FirestoreRest, table: ServerTable, rows: Array<Record<string, unknown>>) {
  if (!db.isEmulator) throw Error('El ensayo de migración solo admite emulador.');
  for (const row of rows) {
    const target = table === 'restaurant_hosts' ? `hostnames/${firestoreId(String(row.hostname))}`
      : table === 'platform_domain_config' ? 'platformConfig/domains'
      : table === 'audit_events' ? `auditEvents/${firestoreId(String(row.id))}`
      : table === 'security_migrations' ? `migrationRuns/${firestoreId(String(row.id))}`
      : table === 'auth_sessions' ? `platformConfig/sessionGrants/entries/${firestoreHashId(String(row.id_hash))}`
      : table === 'owner_devices' ? `platformConfig/deviceGrants/entries/${firestoreHashId(String(row.id_hash))}`
      : table === 'auth_challenges' ? `securityChallenges/${firestoreHashId(String(row.id_hash))}`
      : `rateLimits/${firestoreHashId(await digest(`${row.bucket}:${row.key_hash}`))}`;
    const converted = Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), typeof value === 'string' && /_(at)$/.test(key) && !Number.isNaN(Date.parse(value)) ? new Date(value) : value]));
    if (table === 'owner_devices') converted.scope = 'owner';
    if (table === 'restaurant_hosts' || table === 'platform_domain_config') {
      converted.validation = row.validation_data ? JSON.parse(String(row.validation_data)) : null;
      delete converted.validationData;
    }
    if (table === 'platform_domain_config') delete converted.id;
    const candidates: FirestoreWrite[] = [{ path: target, data: converted, exists: false }];
    if (table === 'restaurant_hosts') candidates.push({ path: `platformConfig/hostnameKinds/entries/${firestoreId(String(row.restaurant_id))}-${firestoreId(String(row.kind))}`, data: { hostname: row.hostname }, exists: false });
    const writes: FirestoreWrite[] = [];
    for (const candidate of candidates) {
      const existing = await db.get(candidate.path);
      if (existing && canonical(existing.data) !== canonical(candidate.data)) throw Error(`Destino modificado durante la importación de ${table}; no se sobrescribirá.`);
      if (!existing) writes.push(candidate);
    }
    // Each source row and its unique reservation are atomic. Exact duplicates
    // are safe on resume; changed rows stop instead of overwriting live state.
    if (writes.length) await db.commit(writes);
  }
}
