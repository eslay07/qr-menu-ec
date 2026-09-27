import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleOwnerAuth } from '../lib/owner-auth';
import { handleCreatorApi, type CentralEnv } from '../lib/central-api';
import { AuthSecurity } from '../lib/auth-security';
import { digest, passwordHash } from '../lib/security';
import { blankCatalog, defaultSettings } from '../lib/contracts';
import type { State, Store } from '../lib/store';

function database() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE application (id TEXT PRIMARY KEY, revision INTEGER, data TEXT);
    CREATE TABLE auth_sessions (id_hash TEXT PRIMARY KEY,scope TEXT,restaurant_id TEXT,csrf_token TEXT,created_at TEXT,last_seen_at TEXT,idle_expires_at TEXT,absolute_expires_at TEXT,revoked_at TEXT);
    CREATE TABLE auth_challenges (id_hash TEXT PRIMARY KEY,scope TEXT,restaurant_id TEXT,kind TEXT,payload TEXT,attempts INTEGER,expires_at TEXT,created_at TEXT);
    CREATE TABLE rate_limits (key_hash TEXT,bucket TEXT,count INTEGER,reset_at TEXT,PRIMARY KEY(key_hash,bucket));
    CREATE TABLE audit_events (id TEXT,restaurant_id TEXT,actor TEXT,action TEXT,outcome TEXT,duration_ms INTEGER,created_at TEXT,detail TEXT);`);
  sql.exec(readFileSync(new URL('../drizzle/0004_owner_email_index.sql', import.meta.url), 'utf8'));
  const db = { async batch(statements: { run: () => Promise<unknown> }[]) {
    sql.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(await statement.run()); sql.exec('COMMIT'); return results; }
    catch (error) { sql.exec('ROLLBACK'); throw error; }
  }, prepare(query: string) {
    const stmt = sql.prepare(query);
    let args: any[] = [];
    const result = {
      bind(...values: any[]) { args = values; return result; },
      async first() { return stmt.get(...args) || null; },
      async all() { return { results: stmt.all(...args) }; },
      async run() { const r = stmt.run(...args); return { meta: { changes: Number(r.changes) } }; },
    };
    return result;
  } } as unknown as D1Database;
  return { sql, db };
}

test('operator email migration is encrypted, revokes sessions, preserves restaurant and only runs once', async () => {
  const { sql, db } = database();
  const id = '11111111-1111-4111-8111-111111111111';
  const state = { draft: { name: 'Mi carta' }, password: { hash: 'unchanged' }, security: { emailHash: 'old' } };
  sql.prepare('INSERT INTO application VALUES (?,7,?)').run(id, JSON.stringify(state));
  const env = { DB: db, DATA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    OWNER_EMAIL_MIGRATION: JSON.stringify({ id: 'test-migration', restaurantId: id, email: 'New@example.com' }) } as CentralEnv;
  const security = new AuthSecurity(env);
  await security.createSession('owner', id);
  const request = new Request('https://menu.test/api/owner/login');
  const noStore = () => { throw Error('Migration must use a single database transaction'); };
  try {
    assert.equal((await handleOwnerAuth(request, env, noStore)).status, 200);
    const row = sql.prepare('SELECT * FROM application WHERE id = ?').get(id) as any;
    const migrated = JSON.parse(row.data);
    assert.equal(row.revision, 8);
    assert.deepEqual(migrated.draft, state.draft);
    assert.deepEqual(migrated.password, state.password);
    assert.equal(migrated.security.emailHash, await digest('new@example.com'));
    assert.equal(await security.decrypt(migrated.security.emailCiphertext), 'new@example.com');
    assert.equal(row.data.includes('new@example.com'), false);
    assert.equal(sql.prepare('SELECT COUNT(*) AS count FROM auth_sessions WHERE revoked_at IS NULL').get()!.count, 0);
    await handleOwnerAuth(request, env, noStore);
    assert.equal(sql.prepare('SELECT revision FROM application WHERE id = ?').get(id)!.revision, 8);
  } finally { sql.close(); }
});

test('owner email login issues a scoped secure session without MFA and rejects abuse', async () => {
  const { sql, db } = database();
  const id = '11111111-1111-4111-8111-111111111111';
  const state: State = { schemaVersion: 1, restaurantId: id, ownerId: 'owner', draft: blankCatalog, settings: defaultSettings,
    published: null, license: null, password: { salt: 'test-salt', hash: await passwordHash('Test-password-123', 'test-salt'), iterations: 600000 },
    recoveryHash: '', sessionEpoch: 0, failures: { count: 0, until: 0 }, createdAt: new Date().toISOString(), access: { active: true },
    security: { emailHash: await digest('owner@example.com'), totpCiphertext: 'existing-authenticator-must-not-be-required' } };
  sql.prepare('INSERT INTO application VALUES (?,0,?)').run(id, JSON.stringify(state));
  const env = { DB: db, DATA_ENCRYPTION_KEY: 'test-enabled', TURNSTILE_SECRET_KEY: 'test-key' } as CentralEnv;
  const store: Store = {
    async read() { const row = sql.prepare('SELECT * FROM application WHERE id = ?').get(id) as any; return { revision: row.revision, state: JSON.parse(row.data) }; },
    async commit(s, revision) { return sql.prepare('UPDATE application SET data = ?,revision = revision + 1 WHERE id = ? AND revision = ?').run(JSON.stringify(s), id, revision).changes === 1; },
    async mediaGet() { return null; }, async mediaPut() {},
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => Response.json({ success: (init?.body as FormData).get('response') === 'valid' });
  const request = (data: object, origin = 'https://menu.test') => new Request('https://menu.test/api/owner/login', {
    method: 'POST', headers: { 'content-type': 'application/json', origin, 'cf-connecting-ip': '192.0.2.1' }, body: JSON.stringify(data),
  });
  const values = { email: ' OWNER@example.com ', password: 'Test-password-123', turnstileToken: 'valid' };
  try {
    assert.equal((await handleOwnerAuth(request(values, 'https://attacker.test'), env, () => store)).status, 403);
    assert.equal((await handleOwnerAuth(request({ ...values, role: 'creator' }), env, () => store)).status, 400);
    assert.equal((await handleOwnerAuth(request({ ...values, turnstileToken: 'invalid' }), env, () => store)).status, 403);
    assert.equal((await handleOwnerAuth(request({ ...values, password: 'incorrect' }), env, () => store)).status, 401);
    const success = await handleOwnerAuth(request(values), env, () => store);
    assert.equal(success.status, 200);
    const result = await success.json() as any;
    assert.equal(result.ownerUrl, `/r/${id}/`);
    assert.equal(result.mfaRequired, undefined);
    assert.match(success.headers.get('set-cookie')!, /__Host-qrmenu_owner=.*HttpOnly; Secure; SameSite=Strict/);
    const security = new AuthSecurity(env);
    const authenticated = new Request('https://menu.test', { headers: { cookie: success.headers.get('set-cookie')!.split(';')[0] } });
    assert.ok(await security.session(authenticated, 'owner', id));
    assert.equal(await security.session(authenticated, 'creator', null), null);
    assert.equal(await security.session(authenticated, 'owner', 'another-restaurant'), null);
    state.access!.active = false;
    sql.prepare('UPDATE application SET data = ? WHERE id = ?').run(JSON.stringify(state), id);
    assert.equal((await handleOwnerAuth(request(values), env, () => store)).status, 401);
    await handleOwnerAuth(request(values), env, () => store);
    assert.equal((await handleOwnerAuth(request(values), env, () => store)).status, 429);
    assert.throws(() => sql.prepare('INSERT INTO application VALUES (?,0,?)').run('duplicate', JSON.stringify(state)), /UNIQUE/);
  } finally { globalThis.fetch = realFetch; sql.close(); }
});

test('creator recovery uses configured email and canonical link; token is single use and revokes sessions', async () => {
  const { sql, db } = database();
  const state = { password: { salt: 'creator-salt', hash: await passwordHash('original-password', 'creator-salt'), iterations: 600000 },
    sessionEpoch: 0, failures: { count: 0, until: 0 }, security: { totpCiphertext: 'old-totp' } };
  sql.prepare('INSERT INTO application VALUES (?,0,?)').run('__creator__', JSON.stringify(state));
  const env = { DB: db, DATA_ENCRYPTION_KEY: 'test-enabled', TURNSTILE_SECRET_KEY: 'test-key', CREATOR_RECOVERY_EMAIL: 'recovery@example.com',
    RESEND_API_KEY: 'test-email-key', EMAIL_FROM: 'support@example.com', EMAIL_VERIFICATION_ENABLED: 'false', PUBLIC_APP_ORIGIN: 'https://menu.test' } as CentralEnv;
  const realFetch = globalThis.fetch;
  let sent: any;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('siteverify')) return Response.json({ success: true });
    sent = JSON.parse(init!.body as string); return Response.json({ id: 'email-id' });
  };
  const request = (path: string, body: object) => new Request(`https://menu.test/api/creator/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://menu.test' }, body: JSON.stringify(body) });
  try {
    const security = new AuthSecurity(env);
    await security.createSession('creator', null);
    assert.equal((await handleCreatorApi(request('recovery/request', { turnstileToken: 'valid' }), env)).status, 200);
    assert.deepEqual(sent.to, ['recovery@example.com']);
    const href = sent.html.match(/href="([^"]+)"/)[1];
    assert.equal(new URL(href).origin, 'https://menu.test');
    const token = new URLSearchParams(new URL(href).hash.slice(1)).get('recover')!;
    const reset = { token, password: 'New-password-123', turnstileToken: 'valid' };
    assert.equal((await handleCreatorApi(request('recovery/reset', reset), env)).status, 200);
    assert.equal((await handleCreatorApi(request('recovery/reset', reset), env)).status, 400);
    const updated = JSON.parse((sql.prepare("SELECT data FROM application WHERE id = '__creator__'").get() as any).data);
    assert.equal(updated.security.totpCiphertext, undefined);
    assert.equal(updated.password.hash, await passwordHash('New-password-123', updated.password.salt));
    assert.equal((sql.prepare('SELECT COUNT(*) AS count FROM auth_sessions WHERE revoked_at IS NULL').get() as any).count, 0);
    const login = await handleCreatorApi(request('login', { password: 'New-password-123', turnstileToken: 'valid' }), { ...env, DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') });
    assert.equal((await login.json() as any).mfaRequired, true);
  } finally { globalThis.fetch = realFetch; sql.close(); }
});
