import type { State } from './store';
import { FirestoreRest, type FirestoreData } from './firestore-rest';
import { FirestoreRestaurantStore } from './firestore-store';
import { findFirestoreOwner, readPrivateRecord, savePrivateRecord } from './firestore-business';
import { firestoreBearer } from './firestore-credentials';
import { D1DocumentStore } from './d1-documents';

export type DataEnv = { DB: D1Database; DOCUMENT_DB?: D1Database; DATA_PROVIDER?: 'd1' | 'd1-documents' | 'firestore-emulator' | 'firestore'; FIRESTORE_EMULATOR_HOST?: string; FIRESTORE_PROJECT_ID?: string; FIRESTORE_REMOTE_ENABLED?: string; FIRESTORE_SERVICE_ACCOUNT?: string };
const remoteStores = new WeakMap<DataEnv, FirestoreRest>();
export function localFirestore(env: DataEnv) {
  if (env.DATA_PROVIDER === undefined || env.DATA_PROVIDER === 'd1') return null;
  if (env.DATA_PROVIDER === 'd1-documents') {
    let db = remoteStores.get(env);
    if (!db) { db = new D1DocumentStore(env.DOCUMENT_DB || env.DB); remoteStores.set(env,db); }
    return db;
  }
  if (env.DATA_PROVIDER === 'firestore') {
    if (env.FIRESTORE_REMOTE_ENABLED !== 'true' || !env.FIRESTORE_PROJECT_ID || !env.FIRESTORE_SERVICE_ACCOUNT) throw Error('Firestore remoto permanece desactivado.');
    let db = remoteStores.get(env);
    if (!db) { db = new FirestoreRest(env.FIRESTORE_PROJECT_ID, '', firestoreBearer(env.FIRESTORE_PROJECT_ID, env.FIRESTORE_SERVICE_ACCOUNT)); remoteStores.set(env, db); }
    return db;
  }
  if (env.DATA_PROVIDER !== 'firestore-emulator') throw Error('Proveedor de datos no habilitado.');
  return new FirestoreRest(env.FIRESTORE_PROJECT_ID || 'demo-qr-menu-ec', env.FIRESTORE_EMULATOR_HOST || '');
}
const unusedMedia = { async mediaGet() { throw Error('La operación no dispone de archivos.'); }, async mediaPut() { throw Error('La operación no dispone de archivos.'); } };
export class ApplicationRepository {
  private firestore;
  constructor(private env: DataEnv) { this.firestore = localFirestore(env); }
  async read(id: string): Promise<{ revision: number; data: string } | null> {
    if (!this.firestore) return this.env.DB.prepare('SELECT revision,data FROM application WHERE id = ?').bind(id).first<{ revision: number; data: string }>();
    if (id === '__creator__') {
      const value = await readPrivateRecord(this.firestore, 'creator');
      return value ? { revision: value.revision, data: JSON.stringify(value.state) } : null;
    }
    const value = await new FirestoreRestaurantStore(this.firestore, id, unusedMedia).read();
    return value ? { revision: value.revision, data: JSON.stringify(value.state) } : null;
  }
  async commit(id: string, state: object, revision: number | null) {
    if (this.firestore) return id === '__creator__'
      ? savePrivateRecord(this.firestore, 'creator', state as FirestoreData, revision)
      : new FirestoreRestaurantStore(this.firestore, id, unusedMedia).commit(state as State, revision);
    const serialized = JSON.stringify(state);
    const result = revision === null
      ? await this.env.DB.prepare('INSERT OR IGNORE INTO application (id,revision,data) VALUES (?,0,?)').bind(id, serialized).run()
      : await this.env.DB.prepare('UPDATE application SET revision = revision + 1, data = ? WHERE id = ? AND revision = ?').bind(serialized, id, revision).run();
    return result.meta.changes === 1;
  }
  async list() {
    if (!this.firestore) return (await this.env.DB.prepare("SELECT id,revision,data FROM application WHERE id <> ? AND id NOT GLOB '__mail_failure:*' ORDER BY id").bind('__creator__').all<{ id: string; revision: number; data: string }>()).results;
    const roots = await this.firestore.all('restaurants', 1000);
    const rows: Array<{ id: string; revision: number; data: string }> = [];
    for (const root of roots) {
      const id = root.path.split('/').pop()!;
      const value = await this.read(id);
      if (value) rows.push({ id, ...value });
    }
    return rows;
  }
  async findByEmail(emailHash: string, exclude?: string) {
    if (this.firestore) {
      const id = await findFirestoreOwner(this.firestore, emailHash);
      return id && id !== exclude ? [{ id }] : [];
    }
    const rows = await this.env.DB.prepare("SELECT id FROM application WHERE id <> '__creator__' AND json_extract(data, '$.security.emailHash') = ? LIMIT 2").bind(emailHash).all<{ id: string }>();
    return rows.results.filter(row => row.id !== exclude);
  }
}
