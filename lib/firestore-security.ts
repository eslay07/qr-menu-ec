import { FirestoreError, FirestoreRest, firestoreHashId, type FirestoreData } from './firestore-rest';
import { digest } from './security';

type Kind = 'sessions' | 'devices' | 'challenges';
const collections = { sessions: 'platformConfig/sessionGrants/entries', devices: 'platformConfig/deviceGrants/entries', challenges: 'securityChallenges' };
export type Grant = { session_hash?: string; id_hash: string; scope: 'owner' | 'creator'; restaurant_id: string | null; csrf_token: string; created_at: string; last_seen_at: string; idle_expires_at: string; absolute_expires_at: string; revoked_at: string | null };
export type Challenge = { id_hash: string; scope: 'owner' | 'creator'; restaurant_id: string | null; kind: 'mfa_login' | 'mfa_setup' | 'email_verify' | 'password_reset'; payload: string; attempts: number; expires_at: string; created_at: string };
const camel = (key: string) => key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
const snake = (key: string) => key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
function toDocument(row: FirestoreData) { return Object.fromEntries(Object.entries(row).map(([key, value]) => [camel(key), typeof value === 'string' && key.endsWith('_at') ? new Date(value) : value])); }
function fromDocument<T>(row: FirestoreData) { return Object.fromEntries(Object.entries(row).map(([key, value]) => [snake(key), value])) as T; }

// Private grant records supplement Firebase identity (CSRF, idle expiry,
// individual revocation, creator TOTP). No password or bearer token is stored.
export class FirestoreSecurityRepository {
  constructor(readonly db: FirestoreRest) {}
  private path(kind: Kind, hash: string) { return `${collections[kind]}/${firestoreHashId(hash)}`; }
  async create(kind: Kind, row: Grant | Challenge) { await this.db.commit([{ path: this.path(kind, row.id_hash), data: toDocument(row), exists: false }]); }
  async get<T = Grant>(kind: Kind, hash: string) {
    const row = await this.db.get(this.path(kind, hash));
    return row ? fromDocument<T>(row.data) : null;
  }
  async mutate<T extends Grant | Challenge>(kind: Kind, hash: string, change: (row: T) => T | null | false) {
    const path = this.path(kind, hash);
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = await this.db.get(path);
      if (!current) return false;
      const next = change(fromDocument<T>(current.data));
      if (next === false) return false;
      try {
        await this.db.commit([{ path, ...(next === null ? { delete: true } : { data: toDocument(next) }), updateTime: current.updateTime }]);
        return true;
      } catch (error) { if (!(error instanceof FirestoreError && error.conflict)) throw error; }
    }
    throw Error('Conflicto de seguridad. Intenta nuevamente.');
  }
  valid(row: Grant) { return !row.revoked_at && Date.parse(row.idle_expires_at) > Date.now() && Date.parse(row.absolute_expires_at) > Date.now(); }
  async rotateDevice(hash: string, csrf: string, nextHash: string, nextCsrf: string) {
    const path = this.path('devices', hash), current = await this.db.get(path);
    if (!current) return false;
    const row = fromDocument<Grant>(current.data);
    if (!this.valid(row) || row.csrf_token !== csrf) return false;
    try {
      await this.db.commit([
        { path, delete: true, updateTime: current.updateTime },
        { path: this.path('devices', nextHash), data: toDocument({ ...row, id_hash: nextHash, csrf_token: nextCsrf, last_seen_at: new Date().toISOString(), idle_expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString() }), exists: false },
      ]);
      return true;
    } catch (error) { if (error instanceof FirestoreError && error.conflict) return false; throw error; }
  }
  async list(kind: Kind, scope: string, restaurantId: string | null) {
    return (await this.db.query(collections[kind], [{ field: 'scope', value: scope }, { field: 'restaurantId', value: restaurantId }], 1000)).map(row => fromDocument<Grant>(row.data));
  }
  async revoke(kind: 'sessions' | 'devices', scope: string, restaurantId: string | null, hash?: string) {
    for (;;) {
      const rows = hash ? [await this.get<Grant>(kind, hash)].filter(row => row !== null) : (await this.db.query(collections[kind], [{ field: 'scope', value: scope }, { field: 'restaurantId', value: restaurantId }, { field: 'revokedAt', value: null }])).map(row => fromDocument<Grant>(row.data));
      for (const row of rows) if (row.scope === scope && row.restaurant_id === restaurantId) await this.mutate<Grant>(kind, row.id_hash, current => ({ ...current, revoked_at: new Date().toISOString() }));
      if (hash || !rows.length) break;
    }
  }
  async take(hash: string, scope?: string, restaurantId?: string | null, kind?: string) {
    let result: Challenge | null = null;
    await this.mutate<Challenge>('challenges', hash, row => {
      if (Date.parse(row.expires_at) <= Date.now() || row.attempts >= 5 || (scope && row.scope !== scope) || (restaurantId !== undefined && row.restaurant_id !== restaurantId) || (kind && row.kind !== kind)) return false;
      result = row;
      return null;
    }).then(taken => { if (!taken) result = null; });
    return result as Challenge | null;
  }
  async consumeLimit(keyHash: string, bucket: string, limit: number, windowMs: number) {
    const path = `rateLimits/${firestoreHashId(await digest(`${bucket}:${keyHash}`))}`;
    for (let attempt = 0; attempt < 12; attempt++) {
      const row = await this.db.get<{ count: number; resetAt: string }>(path);
      const now = Date.now();
      const active = row && Date.parse(row.data.resetAt) > now;
      if (active && row.data.count >= limit) return { allowed: false, retryAfter: Math.max(1, Math.ceil((Date.parse(row.data.resetAt) - now) / 1000)) };
      try {
        await this.db.commit([{ path, data: { keyHash, bucket, count: active ? row.data.count + 1 : 1, resetAt: new Date(active ? row.data.resetAt : now + windowMs) }, ...(row ? { updateTime: row.updateTime } : { exists: false }) }]);
        return { allowed: true, retryAfter: 0 };
      } catch (error) { if (!(error instanceof FirestoreError && error.conflict)) throw error; }
    }
    return { allowed: false, retryAfter: Math.max(1, Math.ceil(windowMs / 1000)) };
  }
  async audit(data: FirestoreData) { await this.db.commit([{ path: `auditEvents/${crypto.randomUUID()}`, data, exists: false }]); }
  async clearChallenges(scope: string) {
    for (;;) {
      const rows = await this.db.query(collections.challenges, [{ field: 'scope', value: scope }]);
      if (!rows.length) break;
      await this.db.commit(rows.map(row => ({ path: row.path, delete: true, updateTime: row.updateTime })));
    }
  }
  async cleanup() {
    const now = new Date();
    for (const [collection, field, value] of [
      [collections.sessions, 'absoluteExpiresAt', now], [collections.sessions, 'idleExpiresAt', now],
      [collections.devices, 'absoluteExpiresAt', now], [collections.devices, 'idleExpiresAt', now],
      [collections.challenges, 'expiresAt', now], ['rateLimits', 'resetAt', now], ['auditEvents', 'createdAt', new Date(Date.now() - 90 * 86_400_000)],
    ] as const) {
      for (let batch = 0; batch < 20; batch++) {
        const rows = await this.db.query(collection, [{ field, value, op: 'LESS_THAN_OR_EQUAL' }]);
        if (!rows.length) break;
        try { await this.db.commit(rows.map(row => ({ path: row.path, delete: true, updateTime: row.updateTime }))); }
        catch (error) { if (!(error instanceof FirestoreError && error.conflict)) throw error; }
      }
    }
  }
}
