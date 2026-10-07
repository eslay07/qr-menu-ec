import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { AuthSecurity, type SecurityEnv } from '../lib/auth-security';
import { FirebaseAuthFailure, FirebaseAuthProvider } from '../lib/firebase-auth-provider';
import { encryptSensitive, passwordHash, randomToken } from '../lib/security';
import type { State } from '../lib/store';

const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
test('Firebase transport preserves the Workers global receiver', async () => {
  const { env } = environment();
  const calls: string[] = [];
  const transport = async function(this: unknown, input: RequestInfo | URL) {
    assert.equal(this, globalThis, 'Workers fetch requires its global receiver');
    calls.push(String(input));
    return Response.json({ localId: 'owner:test', idToken: 'test-token' });
  } as typeof fetch;
  const provider = new FirebaseAuthProvider(env, transport);
  assert.equal(await provider.signIn('owner@example.test', 'test-only', 'owner:test'), 'test-token');
  assert.equal(calls.length, 1);
});
test('Firebase OAuth and administrative lookup preserve the Workers global receiver', async () => {
  const { env } = environment();
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ project_id: 'demo-auth', client_email: 'test@demo-auth.iam.gserviceaccount.com', private_key: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  const calls: string[] = [];
  const transport = async function(this: unknown, input: RequestInfo | URL) {
    assert.equal(this, globalThis);
    calls.push(String(input));
    return Response.json(String(input).includes('oauth2.googleapis.com') ? { access_token: 'test-token', expires_in: 3600 } : { users: [] });
  } as typeof fetch;
  assert.equal(await new FirebaseAuthProvider(env, transport).lookup('test-user'), null);
  assert.equal(calls.length, 2);
});
function environment() {
  const queries: string[] = [];
  const env: SecurityEnv = {
    AUTH_PROVIDER: 'firebase', FIREBASE_PROJECT_ID: 'demo-auth', FIREBASE_API_KEY: 'test-only',
    FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'demo-auth', client_email: 'test@demo-auth.iam.gserviceaccount.com', private_key: 'test-only-not-a-key' }),
    DATA_ENCRYPTION_KEY: key,
    DB: { prepare(query: string) {
      queries.push(query);
      return { bind() { return this; }, async run() { return { meta: { changes: 1 } }; }, async first() { return null; } };
    } } as unknown as D1Database,
  };
  return { env, queries };
}
async function credentials(migrated = false) {
  const salt = randomToken();
  return {
    password: migrated ? { salt: '', hash: '', iterations: 0 } : { salt, hash: await passwordHash('Correcta-123456', salt, 100_000), iterations: 100_000 },
    security: {
      emailCiphertext: await encryptSensitive('owner@example.test', key),
      ...(migrated ? { firebaseUid: 'owner:restaurant-a' } : {}),
    },
  } satisfies Pick<State, 'password' | 'security'>;
}

test('Firebase mode fails closed with absent credentials or a different project', () => {
  const { env } = environment();
  assert.throws(() => new AuthSecurity({ ...env, FIREBASE_SERVICE_ACCOUNT: undefined }));
  assert.throws(() => new AuthSecurity({ ...env, FIREBASE_PROJECT_ID: 'other-project' }));
});

test('legacy password migrates once and removes its local verifier', async (t) => {
  const { env } = environment();
  const security = new AuthSecurity(env);
  const state = await credentials();
  const create = t.mock.method(FirebaseAuthProvider.prototype, 'createUser', async () => {});
  t.mock.method(FirebaseAuthProvider.prototype, 'lookup', async () => null);
  const signIn = t.mock.method(FirebaseAuthProvider.prototype, 'signIn', async () => 'verified-id-token');
  assert.equal(await security.authenticatePassword(state, 'owner', 'restaurant-a', 'Correcta-123456'), true);
  assert.equal(state.security.firebaseUid, 'owner:restaurant-a');
  assert.equal(state.password.hash, '');
  assert.equal(create.mock.callCount(), 1);
  assert.equal(await security.authenticatePassword(state, 'owner', 'restaurant-a', 'Correcta-123456'), true);
  assert.equal(create.mock.callCount(), 1);
  assert.equal(signIn.mock.callCount(), 2);
});

test('wrong legacy password never creates a Firebase account', async (t) => {
  const create = t.mock.method(FirebaseAuthProvider.prototype, 'createUser', async () => {});
  assert.equal(await new AuthSecurity(environment().env).authenticatePassword(await credentials(), 'owner', 'restaurant-a', 'incorrecta'), false);
  assert.equal(create.mock.callCount(), 0);
});

test('creator without email migrates with server recovery address and preserves TOTP', async (t) => {
  const { env } = environment();
  env.CREATOR_RECOVERY_EMAIL = 'Creator@example.test';
  const state: Pick<State, 'password' | 'security'> = await credentials();
  state.security = { totpCiphertext: 'unchanged-ciphertext', totpEnabledAt: '2026-01-01T00:00:00Z' };
  const security = new AuthSecurity(env);
  const create = t.mock.method(FirebaseAuthProvider.prototype, 'createUser', async () => {});
  t.mock.method(FirebaseAuthProvider.prototype, 'lookup', async () => null);
  t.mock.method(FirebaseAuthProvider.prototype, 'signIn', async () => 'verified-token');
  assert.equal(await security.authenticatePassword(state, 'creator', null, 'incorrecta'), false);
  assert.equal(create.mock.callCount(), 0);
  assert.equal(state.security.emailCiphertext, undefined);
  assert.equal(await security.authenticatePassword(state, 'creator', null, 'Correcta-123456'), true);
  assert.equal(create.mock.calls[0].arguments[1], 'creator@example.test');
  assert.equal(state.security.totpCiphertext, 'unchanged-ciphertext');
  assert.equal(state.security.firebaseUid, 'qrmenu-creator');
  assert.equal(await security.decrypt(state.security.emailCiphertext!), 'creator@example.test');
  assert.ok((await security.passwordChallengePayload('creator', null)).firebaseIdTokenCiphertext);
});

test('recovery-email bootstrap is forbidden for owners and migrated creators', async () => {
  const { env } = environment();
  env.CREATOR_RECOVERY_EMAIL = 'creator@example.test';
  const state: Pick<State, 'password' | 'security'> = await credentials();
  state.security = {};
  const security = new AuthSecurity(env);
  await assert.rejects(security.authenticatePassword(state, 'owner', 'restaurant-a', 'Correcta-123456'), {code:'EMAIL_REQUIRED'});
  state.security = { firebaseUid: 'qrmenu-creator' };
  await assert.rejects(security.authenticatePassword(state, 'creator', null, 'Correcta-123456'), {code:'EMAIL_REQUIRED'});
});

test('creator email bootstrap fails closed and preserves state on provider errors', async (t) => {
  const { env } = environment();
  const state: Pick<State, 'password' | 'security'> = await credentials();
  state.security = { totpCiphertext: 'preserved' };
  const before = structuredClone(state);
  await assert.rejects(new AuthSecurity(env).authenticatePassword(state, 'creator', null, 'Correcta-123456'), {code:'EMAIL_REQUIRED'});
  env.CREATOR_RECOVERY_EMAIL = 'creator@example.test';
  t.mock.method(FirebaseAuthProvider.prototype, 'lookup', async () => { throw new FirebaseAuthFailure('ADMIN_UNAVAILABLE'); });
  await assert.rejects(new AuthSecurity(env).authenticatePassword(state, 'creator', null, 'Correcta-123456'), {code:'ADMIN_UNAVAILABLE'});
  assert.deepEqual(state, before);
});

test('migrated login has no PBKDF fallback on bad credentials or provider outage', async (t) => {
  const state = await credentials(true);
  const security = new AuthSecurity(environment().env);
  const signIn = t.mock.method(FirebaseAuthProvider.prototype, 'signIn', async () => { throw new FirebaseAuthFailure('INVALID_LOGIN_CREDENTIALS'); });
  assert.equal(await security.authenticatePassword(state, 'owner', 'restaurant-a', 'wrong'), false);
  signIn.mock.mockImplementation(async () => { throw new FirebaseAuthFailure('PROVIDER_UNAVAILABLE'); });
  await assert.rejects(security.authenticatePassword(state, 'owner', 'restaurant-a', 'Correcta-123456'));
});

test('TOTP challenge carries only an encrypted Firebase token and requires explicit resume', async (t) => {
  const { env } = environment();
  const firstRequest = new AuthSecurity(env);
  const state = await credentials();
  t.mock.method(FirebaseAuthProvider.prototype, 'lookup', async () => null);
  t.mock.method(FirebaseAuthProvider.prototype, 'createUser', async () => {});
  t.mock.method(FirebaseAuthProvider.prototype, 'signIn', async () => 'creator-private-id-token');
  t.mock.method(FirebaseAuthProvider.prototype, 'createSession', async () => 'firebase-session-cookie');
  t.mock.method(FirebaseAuthProvider.prototype, 'verifySession', async () => true);
  assert.equal(await firstRequest.authenticatePassword(state, 'creator', null, 'Correcta-123456'), true);
  const payload = await firstRequest.passwordChallengePayload('creator', null);
  assert.equal(JSON.stringify(payload).includes('creator-private-id-token'), false);
  const nextRequest = new AuthSecurity(env);
  await assert.rejects(nextRequest.createSession('creator', null));
  await assert.rejects(nextRequest.resumePasswordChallenge({}, 'creator', null));
  // The route calls this only AFTER verifying and consuming its TOTP challenge.
  await nextRequest.resumePasswordChallenge(payload, 'creator', null);
  const session = await nextRequest.createSession('creator', null);
  assert.match(session.cookie, /firebase-session-cookie; Path=\/; HttpOnly; Secure; SameSite=Strict/);
  await assert.rejects(nextRequest.createSession('creator', null));
});

test('Firebase sessions reject forged cookies before consulting D1 grants', async (t) => {
  const { env, queries } = environment();
  t.mock.method(FirebaseAuthProvider.prototype, 'verifySession', async () => false);
  const request = new Request('https://menu.test/api/creator/session', { headers: { cookie: '__Host-qrmenu_creator=forged' } });
  assert.equal(await new AuthSecurity(env).session(request, 'creator', null), null);
  assert.equal(queries.length, 0);
});

test('session signing errors do not create an authorized grant', async (t) => {
  const { env, queries } = environment();
  const security = new AuthSecurity(env);
  t.mock.method(FirebaseAuthProvider.prototype, 'signIn', async () => 'id-token');
  t.mock.method(FirebaseAuthProvider.prototype, 'createSession', async () => { throw new FirebaseAuthFailure('ADMIN_UNAVAILABLE'); });
  await security.authenticatePassword(await credentials(true), 'owner', 'restaurant-a', 'Correcta-123456');
  await assert.rejects(security.createSession('owner', 'restaurant-a'));
  assert.equal(queries.length, 0);
});

test('Firebase public sign-in rejects a UID belonging to another restaurant', async () => {
  const provider = new FirebaseAuthProvider(environment().env, async () => Response.json({ localId: 'owner:other', idToken: 'token' }));
  await assert.rejects(provider.signIn('owner@example.test', 'password', 'owner:restaurant-a'), (error: unknown) => error instanceof FirebaseAuthFailure && error.code === 'ACCOUNT_MISMATCH');
});

test('Firebase recovery uses its hosted email service and refuses another account', async () => {
  const calls: { url: string; body: any }[] = [];
  const provider = new FirebaseAuthProvider(environment().env, async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body || '{}')) });
    return Response.json({ email: 'owner@example.test' });
  });
  provider.lookup = async uid => ({ localId: uid, email: 'owner@example.test', validSince: '0' });
  await provider.requestPasswordReset('owner@example.test', 'owner:restaurant-a');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /accounts:sendOobCode/);
  assert.deepEqual(calls[0].body, { requestType: 'PASSWORD_RESET', email: 'owner@example.test' });
  await assert.rejects(provider.requestPasswordReset('other@example.test', 'owner:restaurant-a'));
  assert.equal(calls.length, 1);
});

test('Firebase password reset invalidates older remembered devices', async () => {
  const provider = new FirebaseAuthProvider(environment().env);
  provider.lookup = async uid => ({ localId: uid, validSince: '1760000000' });
  assert.equal(await provider.rememberedDeviceValid('owner:restaurant-a', new Date(1759999999_000).toISOString()), false);
  assert.equal(await provider.rememberedDeviceValid('owner:restaurant-a', new Date(1760000001_000).toISOString()), true);
  assert.equal(await provider.rememberedDeviceValid('owner:restaurant-a', 'invalid'), false);
  provider.lookup = async uid => ({ localId: uid, disabled: true });
  assert.equal(await provider.rememberedDeviceValid('owner:restaurant-a', new Date().toISOString()), false);
});
