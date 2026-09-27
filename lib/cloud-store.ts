import { env } from 'cloudflare:workers';
import type { Store, State } from './store';
export type Bindings = {
  DB: D1Database;
  MEDIA?: R2Bucket;
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
  return {
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
      const r =
        revision === null
          ? await e.DB.prepare(
              'INSERT OR IGNORE INTO application (id,revision,data) VALUES (?,0,?)',
            )
              .bind(id, JSON.stringify(state))
              .run()
          : await e.DB.prepare(
              'UPDATE application SET revision = revision + 1, data = ? WHERE id = ? AND revision = ?',
            )
              .bind(JSON.stringify(state), id, revision)
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
}
