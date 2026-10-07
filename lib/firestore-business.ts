import { FirestoreRest, firestoreId, firestoreHashId, type FirestoreData } from './firestore-rest';
import type { State } from './store';
import { z } from 'zod';
import { pushJob } from './firestore-push';

export type OwnerNotification = { id: string; kind: 'order' | 'license' | 'backup' | 'domain' | 'security' | 'sold_out' | 'daily_summary' | 'inactivity'; title: string; message: string; read: boolean; createdAt: string };
// Trusted-server operations only. Callers must authenticate and authorize the
// restaurant before constructing this repository; browser rules are separate.
export class FirestoreBusinessRepository {
  readonly path: string;
  constructor(readonly db: FirestoreRest, restaurantId: string) { this.path = `restaurants/${firestoreId(restaurantId)}`; }
  async notify(notification: OwnerNotification) {
    const preference = notification.kind === 'daily_summary' ? 'dailySummary' : notification.kind === 'inactivity' ? 'inactivity' : null;
    await this.db.commit([{ path: `${this.path}/notifications/${firestoreId(notification.id)}`, data: { ...notification, createdAt: new Date(notification.createdAt) }, exists: false },
      ...(preference ? [pushJob(this.path.split('/')[1], notification.id, preference, new Date(notification.createdAt))] : [])]);
  }
  async notifications(pageToken?: string) {
    const cursor = pageToken ? z.object({ at: z.string().datetime(), id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/) }).strict().parse(JSON.parse(atob(pageToken))) : null;
    const documents = await this.db.query<OwnerNotification>(`${this.path}/notifications`, [], 31, { orderBy: [{ field: 'createdAt', direction: 'DESCENDING' }, { field: '__name__', direction: 'DESCENDING' }], ...(cursor ? { startAfter: [{ value: new Date(cursor.at) }, { reference: `${this.path}/notifications/${cursor.id}` }] } : {}) });
    const page = documents.slice(0, 30), last = page.at(-1);
    return { documents: page, nextPageToken: documents.length > 30 && last ? btoa(JSON.stringify({ at: last.data.createdAt, id: last.data.id })) : undefined };
  }
  async notification(id: string) {
    return (await this.db.get<OwnerNotification>(`${this.path}/notifications/${firestoreId(id)}`))?.data ?? null;
  }
  async markRead(id: string) {
    const path = `${this.path}/notifications/${firestoreId(id)}`;
    const current = await this.db.get(path);
    if (!current) return false;
    await this.db.commit([{ path, data: { read: true }, mask: ['read'], updateTime: current.updateTime }]);
    return true;
  }
  // Metadata only, never label an incomplete snapshot as restorable.
  async recordBackup(id: string, manifest: { revision: number; catalogIds: string[]; orderCount: number; mediaCount: number; checksum: string; status: 'staging' | 'verified' | 'failed' }) {
    await this.db.commit([{ path: `${this.path}/backups/${firestoreId(id)}`, data: { ...manifest, createdAt: new Date() }, exists: false }]);
  }
  backups(pageToken?: string) { return this.db.list(`${this.path}/backups`, 30, pageToken); }
}

export function businessSnapshot(state: State) {
  // Authentication, license grants, owner IDs and administrator permissions
  // deliberately cannot be restored from a business backup.
  return { schemaVersion: 3, sourceId: state.restaurantId, draft: state.draft, published: state.published, settings: state.settings };
}

export async function findFirestoreOwner(db: FirestoreRest, emailHash: string) {
  const index = await db.get<{ restaurantId: string }>(`platformConfig/ownerEmails/entries/${firestoreHashId(emailHash)}`);
  return index?.data.restaurantId ?? null;
}

export async function readPrivateRecord<T>(db: FirestoreRest, id: string) {
  const row = await db.get<{ revision: number; state: T }>(`platformConfig/${firestoreId(id)}`);
  return row?.data ?? null;
}
export async function savePrivateRecord(db: FirestoreRest, id: string, state: FirestoreData, revision: number | null) {
  const path = `platformConfig/${firestoreId(id)}`;
  const row = await db.get<{ revision: number }>(path);
  if (revision === null ? !!row : !row || row.data.revision !== revision) return false;
  await db.commit([{ path, data: { revision: revision === null ? 0 : revision + 1, state }, ...(row ? { updateTime: row.updateTime } : { exists: false }) }]);
  return true;
}
