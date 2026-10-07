import { FirestoreError, FirestoreRest } from './firestore-rest';
import {entitlements} from './entitlements';
import { FirestoreSecurityRepository } from './firestore-security';
import { FirestoreBusinessRepository } from './firestore-business';
import { NotificationSettings } from './restaurant-preferences';
import type { OrderRecord } from './orders';
import type { FirestoreBackupRepository } from './firestore-backups';
import { cleanupCatalogVersions } from './firestore-version-cleanup';
import { purgeExpiredMailFailures } from './mail-failures';

export async function firestoreMaintenance(db: FirestoreRest, now = new Date(), backupFor?: (restaurantId: string) => FirestoreBackupRepository) {
  await new FirestoreSecurityRepository(db).cleanup();
  await purgeExpiredMailFailures(db, now);
  const day = new Date(now.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
  const dayStart = new Date(`${day}T05:00:00.000Z`);
  const yesterday = new Date(dayStart.getTime() - 86_400_000);
  let pageToken: string | undefined;
  do {
    const page = await db.list<{ access: { active: boolean; plan?:'basic'|'medium'|'premium' }; createdAt: string }>('restaurants', 50, pageToken);
    for (const restaurant of page.documents) {
      const restaurantId = restaurant.path.split('/').pop()!;
      const expiredPush = await db.query(`${restaurant.path}/pushDevices`, [{ field: 'expiresAt', op: 'LESS_THAN_OR_EQUAL', value: now }], 200);
      if (expiredPush.length) await db.commit(expiredPush.map(row => ({ path: row.path, delete: true, updateTime: row.updateTime })));
      await cleanupCatalogVersions(db, restaurantId, now);
      const orderPath = `${restaurant.path}/orders`;
      // This job anonymizes expired customer aliases. It NEVER deletes real
      // orders; deleting security records is a separate repository operation.
      let expiredCursor: { value?: unknown; reference?: string }[] | undefined;
      for (;;) {
        const expired = await db.query<OrderRecord>(orderPath, [{ field: 'publicExpiresAt', op: 'LESS_THAN_OR_EQUAL', value: now }], 200, {
          orderBy: [{ field: 'publicExpiresAt', direction: 'ASCENDING' }, { field: '__name__', direction: 'ASCENDING' }],
          startAfter: expiredCursor,
        });
        if (!expired.length) break;
        const last = expired[expired.length - 1];
        expiredCursor = [{ value: new Date(last.data.publicExpiresAt) }, { reference: last.path }];
        for (const row of expired) {
        if (row.data.demo) {
          const lines = await db.all(`${row.path}/lines`, 100);
          await db.commit([...lines.map(line => ({ path: line.path, delete: true })), { path: row.path, delete: true, updateTime: row.updateTime }]);
        } else if (row.data.alias) await db.commit([{ path: row.path, data: { alias: '' }, mask: ['alias'], updateTime: row.updateTime }]);
        }
        if (expired.length < 200) break;
      }
      if (restaurant.data.access?.active === false) continue;
      if (backupFor && entitlements(restaurant.data.access).scheduledBackups) {
        const policy = await db.get<{ automatic: boolean }>(`${restaurant.path}/private/backupPolicy`);
        if (policy?.data.automatic === true) await backupFor(restaurantId).automatic(now);
      }
      if (!entitlements(restaurant.data.access).notificationPreferences) continue;
      const settings = NotificationSettings.parse((await db.get(`${restaurant.path}/settings/notifications`))?.data || {});
      const business = new FirestoreBusinessRepository(db, restaurantId);
      const notify = async (id: string, kind: 'daily_summary' | 'inactivity', title: string, message: string) => {
        try { await business.notify({ id, kind, title, message, read: false, createdAt: now.toISOString() }); }
        catch (error) { if (!(error instanceof FirestoreError && error.conflict)) throw error; }
      };
      if (settings.dailySummary) {
        // Read only headers, paginated; a summary must not silently stop at the
        // interactive reports limit or fetch every individual order line.
        let count = 0, totalCents = 0;
        let cursor: { value?: unknown; reference?: string }[] | undefined;
        for (;;) {
          const rows = await db.query<OrderRecord>(orderPath, [
            { field: 'demo', value: false }, { field: 'status', value: 'confirmed' },
            { field: 'createdAt', op: 'GREATER_THAN_OR_EQUAL', value: yesterday },
            { field: 'createdAt', op: 'LESS_THAN', value: dayStart },
          ], 200, { orderBy: [{ field: 'createdAt', direction: 'DESCENDING' }, { field: '__name__', direction: 'ASCENDING' }], startAfter: cursor });
          for (const row of rows) { count++; totalCents += row.data.totalCents; }
          if (rows.length < 200) break;
          const last = rows[rows.length - 1];
          cursor = [{ value: new Date(last.data.createdAt) }, { reference: last.path }];
        }
        await notify(`daily-${day}`, 'daily_summary', 'Resumen diario de ventas', `${count} pedidos confirmados · USD ${(totalCents / 100).toFixed(2)} · ${yesterday.toISOString().slice(0, 10)} (Ecuador). Total de pedidos, no pagos verificados.`);
      }
      if (settings.inactivity && now.getTime() - Date.parse(restaurant.data.createdAt) >= settings.inactivityHours * 3_600_000) {
        const recent = await db.query(orderPath, [{ field: 'demo', value: false }, { field: 'createdAt', op: 'GREATER_THAN', value: new Date(now.getTime() - settings.inactivityHours * 3_600_000) }], 1, { orderBy: [{ field: 'createdAt', direction: 'DESCENDING' }, { field: '__name__', direction: 'ASCENDING' }] });
        if (!recent.length) await notify(`inactivity-${day}`, 'inactivity', 'Sin pedidos recientes', `No se han recibido pedidos en ${settings.inactivityHours} horas. Revisa si el menú está publicado y si el local está atendiendo.`);
      }
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  // Opaque public links expire independently of accounting records. Purging
  // this index must never cascade to real orders or their line snapshots.
  for (;;) {
    const expiredTokens = await db.query('platformConfig/orderTokens/entries', [{ field: 'expiresAt', op: 'LESS_THAN_OR_EQUAL', value: now }], 200);
    if (!expiredTokens.length) break;
    await db.commit(expiredTokens.map(row => ({ path: row.path, delete: true, updateTime: row.updateTime })));
  }
  for (;;) {
    const expired = await db.query('platformConfig/pushTokens/entries', [{ field: 'expiresAt', op: 'LESS_THAN_OR_EQUAL', value: now }], 200);
    if (!expired.length) break;
    await db.commit(expired.map(row => ({ path: row.path, delete: true, updateTime: row.updateTime })));
  }
}
