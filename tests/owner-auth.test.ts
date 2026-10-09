import { requestUrl } from './http-fixture';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleOwnerAuth, handleOwnerDevice } from '../lib/owner-auth';
import { handleCreatorApi, type CentralEnv } from '../lib/central-api';
import { AuthSecurity } from '../lib/auth-security';
import { digest, passwordHash } from '../lib/security';
import { blankCatalog, defaultSettings } from '../lib/contracts';
import type { State, Store } from '../lib/store';
import { FirebaseAuthProvider } from '../lib/firebase-auth-provider';
import { createHmac } from 'node:crypto';
import { MailFailures } from '../lib/mail-failures';

function database() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE application (id TEXT PRIMARY KEY, revision INTEGER, data TEXT);
    CREATE TABLE auth_sessions (id_hash TEXT PRIMARY KEY,scope TEXT,restaurant_id TEXT,csrf_token TEXT,created_at TEXT,last_seen_at TEXT,idle_expires_at TEXT,absolute_expires_at TEXT,revoked_at TEXT);
    CREATE TABLE auth_challenges (id_hash TEXT PRIMARY KEY,scope TEXT,restaurant_id TEXT,kind TEXT,payload TEXT,attempts INTEGER,expires_at TEXT,created_at TEXT);
    CREATE TABLE rate_limits (key_hash TEXT,bucket TEXT,count INTEGER,reset_at TEXT,PRIMARY KEY(key_hash,bucket));
    CREATE TABLE audit_events (id TEXT,restaurant_id TEXT,actor TEXT,action TEXT,outcome TEXT,duration_ms INTEGER,created_at TEXT,detail TEXT);`);
  sql.exec(readFileSync(new URL('../drizzle/0004_owner_email_index.sql', import.meta.url), 'utf8'));
  sql.exec(readFileSync(new URL('../drizzle/0005_device_access.sql', import.meta.url), 'utf8'));
  const db = { async batch(statements: { run: () => Promise<unknown> }[]) {
    sql.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(await statement.run()); sql.exec('COMMIT'); return results; }
    catch (error) { sql.exec('ROLLBACK'); throw error; }
  }, prepare(query: string) {
    const stmt = sql.prepare(query);
    let args: SQLInputValue[] = [];
    const result = {
      bind(...values: SQLInputValue[]) { args = values; return result; },
      async first() { return stmt.get(...args) || null; },
      async all() { return { results: stmt.all(...args) }; },
      async run() { const r = stmt.run(...args); return { meta: { changes: Number(r.changes) } }; },
    };
    return result;
  } } as unknown as D1Database;
  return { sql, db };
}

void test('failed mail retries idempotently, stores encrypted retry data and supports audited manual resend', async t => {
  const { sql, db } = database();
  const env = { DB: db, RESEND_API_KEY: 'test-only', EMAIL_FROM: 'test@example.test', DATA_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64') } as CentralEnv;
  const security = new AuthSecurity(env);
  let succeed = false;
  const keys: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => { keys.push(new Headers(init.headers).get('Idempotency-Key')!); return new Response('{}', { status: succeed ? 200 : 500 }); });
  try {
    await assert.rejects(security.deliverEmail('owner@example.test', 'Recuperación', '<p>private-link</p>'));
    assert.equal(keys.length, 3);
    assert.equal(new Set(keys).size, 1);
    const failures = new MailFailures(env, security);
    const items = await failures.list();
    assert.equal(items.length, 1);
    assert.equal(JSON.stringify(items).includes('private-link'), false);
    assert.equal(String(sql.prepare("SELECT data FROM application WHERE id GLOB '__mail_failure:*'").get()!.data).includes('private-link'), false);
    succeed = true;
    await failures.retry(items[0].id);
    assert.equal(new Set(keys).size, 1);
    assert.equal((await failures.list())[0].status, 'sent');
    await assert.rejects(failures.retry(items[0].id));
    assert.equal(sql.prepare("SELECT count(*) AS n FROM audit_events WHERE action='email.manual-retry'").get()!.n, 1);
    sql.prepare('INSERT INTO application (id, revision, data) VALUES (?, 0, ?)').run('restaurant-preserved', '{}');
    await failures.cleanup(new Date(Date.now() + 31 * 60000));
    assert.equal((await failures.list()).length, 0);
    assert.ok(sql.prepare('SELECT id FROM application WHERE id=?').get('restaurant-preserved'));
  } finally { sql.close(); }
});

void test('device refresh accepts the generated CSRF token and rejects a forged token', async () => {
  const { sql, db } = database();
  const env = { DB: db } as CentralEnv;
  const security = new AuthSecurity(env);
  const issued = await security.createDevice('restaurant-test');
  const loadStore = () => ({ async read() { return { revision: 0, state: { access: { active: true } } }; } }) as unknown as Store;
  const request = (csrf: string) => new Request('https://menu.test/api/owner/device-session/refresh', {
    method: 'POST', headers: { Origin: 'https://menu.test', 'Content-Type': 'application/json', Cookie: issued.cookie.split(';')[0], 'X-CSRF-Token': csrf }, body: '{}',
  });
  try {
    assert.notEqual(issued.csrfToken.length, 64);
    assert.equal((await handleOwnerDevice(request('x'.repeat(43)), env, loadStore)).status, 401);
    const refreshed = await handleOwnerDevice(request(issued.csrfToken), env, loadStore);
    assert.equal(refreshed.status, 200);
    assert.match(refreshed.headers.get('set-cookie')!, /__Host-qrmenu_device=/);
    assert.equal((await refreshed.json() as { ownerUrl: string }).ownerUrl, '/r/restaurant-test/');
    assert.equal((await handleOwnerDevice(request(issued.csrfToken), env, loadStore)).status, 401);
  } finally { sql.close(); }
});

void test('creator Firebase login cannot issue a session before TOTP and cannot replay a challenge', async (t) => {
  const { sql, db } = database();
  const env: CentralEnv = {
    DB: db, CREATOR_SETUP_TOKEN: '', AUTH_PROVIDER: 'firebase',
    FIREBASE_PROJECT_ID: 'demo-auth', FIREBASE_API_KEY: 'test-only',
    FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'demo-auth', client_email: 'test@demo-auth.iam.gserviceaccount.com', private_key: 'test-only' }),
    DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'), TURNSTILE_SECRET_KEY: 'test',
  };
  const security = new AuthSecurity(env);
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const state = {
    password: { salt: 'salt', hash: await passwordHash('Correcta-123456', 'salt', 100_000), iterations: 100_000 },
    sessionEpoch: 0, failures: { count: 0, until: 0 },
    security: { emailCiphertext: await security.encrypt('creator@example.test'), totpCiphertext: await security.encrypt(secret), totpEnabledAt: new Date().toISOString() },
  };
  sql.prepare('INSERT INTO application VALUES (?,0,?)').run('__creator__', JSON.stringify(state));
  t.mock.method(FirebaseAuthProvider.prototype, 'lookup', async () => null);
  t.mock.method(FirebaseAuthProvider.prototype, 'createUser', async () => {});
  t.mock.method(FirebaseAuthProvider.prototype, 'signIn', async () => 'firebase-password-token');
  const issue = t.mock.method(FirebaseAuthProvider.prototype, 'createSession', async () => 'firebase-session');
  t.mock.method(FirebaseAuthProvider.prototype, 'verifySession', async () => true);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true }));
  const request = (path: string, body: object, cookie = '') => new Request(`https://menu.test/api/creator/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://menu.test', cookie }, body: JSON.stringify(body),
  });
  const codeAt = (offset: number) => {
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + offset));
    const hash = createHmac('sha1', '12345678901234567890').update(counter).digest();
    const index = hash[hash.length - 1] & 15;
    const value = ((hash[index] & 127) << 24) | (hash[index + 1] << 16) | (hash[index + 2] << 8) | hash[index + 3];
    return String(value % 1_000_000).padStart(6, '0');
  };
  try {
    const login = await handleCreatorApi(request('login', { password: 'Correcta-123456', turnstileToken: 'valid' }), env);
    assert.equal(login.status, 200);
    assert.equal((await login.json() as {mfaRequired?:boolean}).mfaRequired, true);
    assert.equal(issue.mock.callCount(), 0);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    assert.match(cookie, /^__Host-qrmenu_challenge=/);
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get()!.n, 0);
    const payload = String(sql.prepare('SELECT payload FROM auth_challenges').get()!.payload);
    assert.equal(payload.includes('firebase-password-token'), false);
    const wrongCode = ['000000', '000001', '000002', '000003'].find(code => ![-1, 0, 1].map(codeAt).includes(code))!;
    assert.equal((await handleCreatorApi(request('auth/mfa/verify', { code: wrongCode }, cookie), env)).status, 401);
    assert.equal(issue.mock.callCount(), 0);
    const verified = await handleCreatorApi(request('auth/mfa/verify', { code: codeAt(0) }, cookie), env);
    assert.equal(verified.status, 200);
    assert.match(verified.headers.get('set-cookie')!, /__Host-qrmenu_creator=firebase-session/);
    assert.equal(issue.mock.callCount(), 1);
    assert.equal((await handleCreatorApi(request('auth/mfa/verify', { code: codeAt(0) }, cookie), env)).status, 401);
    assert.equal(issue.mock.callCount(), 1);
    const current = JSON.parse(String(sql.prepare("SELECT data FROM application WHERE id = '__creator__'").get()!.data)) as State;
    assert.ok(current.security);
    assert.equal(current.security.totpCiphertext, state.security.totpCiphertext);
    assert.equal(current.password.hash, '');
  } finally { sql.close(); }
});

void test('remembered device rotates, expires by inactivity and can be revoked without exposing its token', async () => {
  const { sql, db } = database();
  const security = new AuthSecurity({ DB: db } as CentralEnv);
  const restaurantId = '11111111-1111-4111-8111-111111111111';
  try {
    const issued = await security.createDevice(restaurantId);
    assert.match(issued.cookie, /__Host-qrmenu_device=.*HttpOnly; Secure; SameSite=Strict/);
    assert.equal(sql.prepare('SELECT COUNT(*) AS count FROM owner_devices').get()!.count, 1);
    assert.equal(sql.prepare('SELECT id_hash FROM owner_devices').get()!.id_hash === issued.cookie, false);
    const request = (cookie: string, csrf = issued.csrfToken, origin = 'https://menu.test') => new Request('https://menu.test/api/owner/device-session/refresh', {
      method: 'POST', headers: { cookie: cookie.split(';')[0], origin, 'x-csrf-token': csrf, 'content-type': 'application/json' }, body: '{}',
    });
    assert.equal(await security.rotateDevice(request(issued.cookie, 'bad'), 'bad'), null);
    assert.equal(await security.rotateDevice(request(issued.cookie, issued.csrfToken, 'https://attacker.test'), issued.csrfToken), null);
    const rotated = await security.rotateDevice(request(issued.cookie), issued.csrfToken);
    assert.equal(rotated?.restaurantId, restaurantId);
    assert.equal(await security.device(request(issued.cookie)), null);
    assert.ok(await security.device(request(rotated!.cookie)));
    await security.revokeDevicesForRestaurant(restaurantId);
    assert.equal(await security.device(request(rotated!.cookie)), null);
  } finally { sql.close(); }
});

void test('operator email migration is encrypted, revokes sessions, preserves restaurant and only runs once', async () => {
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
    const row = sql.prepare('SELECT * FROM application WHERE id = ?').get(id) as {data:string;revision:number};
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

void test('owner email login issues a scoped secure session without MFA and rejects abuse', async () => {
  const { sql, db } = database();
  const id = '11111111-1111-4111-8111-111111111111';
  const state: State = { schemaVersion: 1, restaurantId: id, ownerId: 'owner', draft: blankCatalog, settings: defaultSettings,
    published: null, license: null, password: { salt: 'test-salt', hash: await passwordHash('Test-password-123', 'test-salt'), iterations: 600000 },
    recoveryHash: '', sessionEpoch: 0, failures: { count: 0, until: 0 }, createdAt: new Date().toISOString(), access: { active: true },
    security: { emailHash: await digest('owner@example.com'), totpCiphertext: 'existing-authenticator-must-not-be-required' } };
  sql.prepare('INSERT INTO application VALUES (?,0,?)').run(id, JSON.stringify(state));
  const env = { DB: db, DATA_ENCRYPTION_KEY: 'test-enabled', TURNSTILE_SECRET_KEY: 'test-key' } as CentralEnv;
  const store: Store = {
    async read() { const row = sql.prepare('SELECT * FROM application WHERE id = ?').get(id) as {data:string;revision:number}; return { revision: row.revision, state: JSON.parse(row.data) }; },
    async commit(s, revision) { return sql.prepare('UPDATE application SET data = ?,revision = revision + 1 WHERE id = ? AND revision = ?').run(JSON.stringify(s), id, revision).changes === 1; },
    async mediaGet() { return null; }, async mediaPut() {},
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    assert.ok(init?.body instanceof FormData);
    return Response.json({ success: init.body.get('response') === 'valid' });
  };
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
    const result = await success.json() as {ownerUrl:string;mfaRequired?:boolean};
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

void test('creator recovery uses configured email and canonical link; token is single use and revokes sessions', async () => {
  const { sql, db } = database();
  const state = { password: { salt: 'creator-salt', hash: await passwordHash('original-password', 'creator-salt'), iterations: 600000 },
    sessionEpoch: 0, failures: { count: 0, until: 0 }, security: { totpCiphertext: 'old-totp' } };
  sql.prepare('INSERT INTO application VALUES (?,0,?)').run('__creator__', JSON.stringify(state));
  const env = { DB: db, DATA_ENCRYPTION_KEY: 'test-enabled', TURNSTILE_SECRET_KEY: 'test-key', CREATOR_RECOVERY_EMAIL: 'recovery@example.com',
    RESEND_API_KEY: 'test-email-key', EMAIL_FROM: 'support@example.com', EMAIL_VERIFICATION_ENABLED: 'false', PUBLIC_APP_ORIGIN: 'https://menu.test' } as CentralEnv;
  const realFetch = globalThis.fetch;
  let sent: {to:string[];html:string}|undefined;
  globalThis.fetch = async (url, init) => {
    if (requestUrl(url).includes('siteverify')) return Response.json({ success: true });
    sent = JSON.parse(init!.body as string); return Response.json({ id: 'email-id' });
  };
  const request = (path: string, body: object) => new Request(`https://menu.test/api/creator/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://menu.test' }, body: JSON.stringify(body) });
  try {
    const security = new AuthSecurity(env);
    await security.createSession('creator', null);
    assert.equal((await handleCreatorApi(request('recovery/request', { turnstileToken: 'valid' }), env)).status, 200);
    assert.ok(sent);
    assert.deepEqual(sent.to, ['recovery@example.com']);
    const href = sent.html.match(/href="([^"]+)"/)![1];
    assert.equal(new URL(href).origin, 'https://menu.test');
    const token = new URLSearchParams(new URL(href).hash.slice(1)).get('recover')!;
    const reset = { token, password: 'New-password-123', turnstileToken: 'valid' };
    assert.equal((await handleCreatorApi(request('recovery/reset', reset), env)).status, 200);
    assert.equal((await handleCreatorApi(request('recovery/reset', reset), env)).status, 400);
    const updated = JSON.parse((sql.prepare("SELECT data FROM application WHERE id = '__creator__'").get() as {data:string}).data);
    assert.equal(updated.security.totpCiphertext, undefined);
    assert.equal(updated.password.hash, await passwordHash('New-password-123', updated.password.salt));
    assert.equal((sql.prepare('SELECT COUNT(*) AS count FROM auth_sessions WHERE revoked_at IS NULL').get() as {count:number}).count, 0);
    const login = await handleCreatorApi(request('login', { password: 'New-password-123', turnstileToken: 'valid' }), { ...env, DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') });
    assert.equal((await login.json() as {mfaRequired?:boolean}).mfaRequired, true);
  } finally { globalThis.fetch = realFetch; sql.close(); }
});
