import { env } from 'cloudflare:workers';
import type { Store, State } from './store';
import { localFirestore, type DataEnv } from './application-repository';
import { FirestoreRestaurantStore } from './firestore-store';
import { FirebaseStorageMedia } from './firebase-storage-media';
import { firestoreBearer } from './firestore-credentials';
export type Bindings = DataEnv & {
  DB: D1Database;
  MEDIA?: R2Bucket;
  MEDIA_PROVIDER?: 'legacy' | 'firebase-storage';
  FIREBASE_STORAGE_ENABLED?: string;
  FIREBASE_STORAGE_BUCKET?: string;
  FIREBASE_STORAGE_PROJECT_ID?: string;
  FIREBASE_STORAGE_SERVICE_ACCOUNT?: string;
  LICENSE_PUBLIC_KEY?: string;
  SETUP_TOKEN?: string;
  PLATFORM_MENU_DOMAIN?: string;
  CLOUDFLARE_ZONE_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_CNAME_TARGET?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_WORKERS_SUBDOMAIN?: string;
  CORE_WORKER_SERVICE?: string;
  DATA_ENCRYPTION_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_SITE_KEY?: string;
  EMAIL_VERIFICATION_ENABLED?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
};
export function bindings() {
  return env as unknown as Bindings;
}
export function cloudStore(id = 'restaurant', source?: Bindings): Store {
  const e = source || bindings();
  const legacy: Store = {
    async read() {
      const row = await e.DB.prepare(
        'SELECT revision,data FROM application WHERE id = ?',
      )
        .bind(id)
        .first<{ revision: number; data: string }>();
      return row
        ? { revision: row.revision, state: JSON.parse(row.data) as State }
        : null;
    },
    async commit(state, revision) {
      const serialized = JSON.stringify(state);
      if (new TextEncoder().encode(serialized).byteLength > 1_800_000)
        throw Error('La carta y la publicación superan el tamaño permitido. Reduce textos u opciones antes de guardar.');
      const r =
        revision === null
          ? await e.DB.prepare(
              'INSERT OR IGNORE INTO application (id,revision,data) VALUES (?,0,?)',
            )
              .bind(id, serialized)
              .run()
          : await e.DB.prepare(
              'UPDATE application SET revision = revision + 1, data = ? WHERE id = ? AND revision = ?',
            )
              .bind(serialized, id, revision)
              .run();
      return r.meta.changes === 1;
    },
    async mediaGet(mediaId) {
      if (e.MEDIA) {
        const r =
          (await e.MEDIA.get(`${id}/${mediaId}`)) ||
          (await e.MEDIA.get(mediaId));
        return r
          ? {
              bytes: new Uint8Array(await r.arrayBuffer()),
              type: r.httpMetadata?.contentType || 'application/octet-stream',
            }
          : null;
      }
      const row = await e.DB.prepare(
        'SELECT type,data FROM media WHERE restaurant_id = ? AND id = ?',
      )
        .bind(id, mediaId)
        .first<{ type: string; data: ArrayBuffer }>();
      return row ? { bytes: new Uint8Array(row.data), type: row.type } : null;
    },
    async mediaPut(mediaId, bytes, type) {
      if (e.MEDIA) {
        await e.MEDIA.put(`${id}/${mediaId}`, bytes, {
          httpMetadata: { contentType: type },
        });
        return;
      }
      const data = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      );
      await e.DB.prepare(
        'INSERT OR REPLACE INTO media (restaurant_id,id,type,data) VALUES (?,?,?,?)',
      )
        .bind(id, mediaId, type, data)
        .run();
    },
  };
  const firestore = localFirestore(e);
  let media: Pick<Store, 'mediaGet' | 'mediaPut'> = legacy;
  if (e.MEDIA_PROVIDER === 'firebase-storage') {
    if (e.FIREBASE_STORAGE_ENABLED !== 'true' || !e.FIREBASE_STORAGE_BUCKET || !e.FIREBASE_STORAGE_PROJECT_ID || !e.FIREBASE_STORAGE_SERVICE_ACCOUNT) throw Error('Storage remoto permanece desactivado.');
    // Demo routes have no persistent uploaded images.
    if (id !== '__demo__') {
      const storage = new FirebaseStorageMedia(e.FIREBASE_STORAGE_BUCKET, id, firestoreBearer(e.FIREBASE_STORAGE_PROJECT_ID, e.FIREBASE_STORAGE_SERVICE_ACCOUNT, 'https://www.googleapis.com/auth/devstorage.read_write'));
      media = { async mediaGet(mediaId) { return await storage.mediaGet(mediaId) || await legacy.mediaGet(mediaId); }, mediaPut: storage.mediaPut.bind(storage) };
    }
  }
  return firestore ? new FirestoreRestaurantStore(firestore, id, media) : { ...legacy, ...media };
}
