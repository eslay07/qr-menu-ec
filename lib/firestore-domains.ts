import { FirestoreRest, firestoreId, type FirestoreWrite } from './firestore-rest';
import type { DomainRecord } from './domains';

export class FirestoreDomainRepository {
  constructor(readonly db: FirestoreRest) {}
  async lookup(hostname: string) { return (await this.db.get<DomainRecord>(`hostnames/${firestoreId(hostname.toLowerCase())}`))?.data ?? null; }
  async list(restaurantId: string) {
    return (await this.db.query<DomainRecord>('hostnames', [{ field: 'restaurantId', value: restaurantId }], 20)).map(row => row.data).sort((a, b) => b.priority - a.priority || b.createdAt.localeCompare(a.createdAt));
  }
  async primary(restaurantId: string) { return (await this.list(restaurantId)).find(row => row.status === 'active') ?? null; }
  async save(record: DomainRecord) {
    const path = `hostnames/${firestoreId(record.hostname)}`;
    const key = `platformConfig/hostnameKinds/entries/${firestoreId(record.restaurantId)}-${record.kind}`;
    const [current, reserved] = await Promise.all([this.db.get<DomainRecord>(path), this.db.get<{ hostname: string }>(key)]);
    if (current && current.data.restaurantId !== record.restaurantId) throw Error('Ese dominio ya pertenece a otro restaurante.');
    const writes: FirestoreWrite[] = [
      { path, data: { ...record, createdAt: new Date(record.createdAt), updatedAt: record.updatedAt ? new Date(record.updatedAt) : null }, ...(current ? { updateTime: current.updateTime } : { exists: false }) },
      { path: key, data: { hostname: record.hostname }, ...(reserved ? { updateTime: reserved.updateTime } : { exists: false }) },
    ];
    if (reserved && reserved.data.hostname !== record.hostname) {
      const old = await this.db.get<DomainRecord>(`hostnames/${firestoreId(reserved.data.hostname)}`);
      if (old?.data.restaurantId === record.restaurantId) writes.push({ path: old.path, delete: true, updateTime: old.updateTime });
    }
    await this.db.commit(writes);
  }
  async removeCustom(restaurantId: string) {
    const rows = (await this.list(restaurantId)).filter(row => row.kind === 'custom');
    for (const row of rows) {
      const current = await this.db.get(`hostnames/${row.hostname}`);
      if (current) await this.db.commit([{ path: current.path, delete: true, updateTime: current.updateTime }, { path: `platformConfig/hostnameKinds/entries/${firestoreId(restaurantId)}-custom`, delete: true }]);
    }
  }
  async capacity() { return (await this.db.query('hostnames', [{ field: 'kind', value: 'workers_dev' }], 1000)).length; }
  async platformConfig() { return (await this.db.get('platformConfig/domains'))?.data ?? null; }
  async setPlatformConfig(data: Record<string, unknown>) { await this.db.commit([{ path: 'platformConfig/domains', data }]); }
}
