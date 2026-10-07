import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { loadEnv } from 'vite';
import { FirebaseAuthProvider } from '../lib/firebase-auth-provider';

if (process.argv[2] !== '--temporary-test-account') throw Error('Explicit temporary-account flag required.');
const project = 'qr-menu-6981a';
const email = `qrmenu-auth-worker@${project}.iam.gserviceaccount.com`;
const vars = loadEnv('development', process.cwd(), 'VITE_FIREBASE_');
assert.equal(vars.VITE_FIREBASE_PROJECT_ID, project);
const require = createRequire(import.meta.url);
const auth = require('firebase-tools/lib/auth');
await require('firebase-tools/lib/requireAuth').requireAuth({ project, nonInteractive: true, ...auth.getProjectDefaultAccount(process.cwd()) });
const { Client } = require('firebase-tools/lib/apiv2');
const iam = new Client({ urlPrefix: 'https://iam.googleapis.com', apiVersion: 'v1' });
const admin = new Client({ urlPrefix: 'https://identitytoolkit.googleapis.com', apiVersion: 'v1' });
const hidden = { skipLog: { reqBody: true, resBody: true } };
const uid = `qrmenu-auth-test-${randomUUID()}`;
const testEmail = `${uid}@example.invalid`;
let keyName: string | undefined;
let created = false;
let stage = 'temporary-key';
try {
  const { body: key } = await iam.post(`projects/${project}/serviceAccounts/${email}/keys`, {
    privateKeyType: 'TYPE_GOOGLE_CREDENTIALS_FILE', keyAlgorithm: 'KEY_ALG_RSA_2048',
  }, hidden);
  keyName = key.name;
  const provider = new FirebaseAuthProvider({
    FIREBASE_PROJECT_ID: project, FIREBASE_API_KEY: vars.VITE_FIREBASE_API_KEY,
    FIREBASE_SERVICE_ACCOUNT: Buffer.from(key.privateKeyData, 'base64').toString('utf8'),
  });
  const password = `QR-${randomUUID()}-${randomUUID()}`;
  stage = 'create-test-user';
  await provider.createUser(uid, testEmail, password);
  created = true;
  stage = 'password-sign-in';
  const token = await provider.signIn(testEmail, password, uid);
  stage = 'session-cookie';
  const cookie = await provider.createSession(token);
  stage = 'verify-cookie';
  assert.equal(await provider.verifySession(cookie, uid), true);
  assert.equal(await provider.verifySession(cookie, 'another-restaurant'), false);
  const parts = cookie.split('.');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  payload.sub = 'another-restaurant';
  parts[1] = Buffer.from(JSON.stringify(payload)).toString('base64url');
  assert.equal(await provider.verifySession(parts.join('.'), 'another-restaurant'), false);
  await new Promise(resolve => setTimeout(resolve, 1200));
  stage = 'password-change-and-revocation';
  await provider.updateUser(uid, { password: `${password}-changed` });
  assert.equal(await provider.verifySession(cookie, uid), false);
  await assert.rejects(provider.signIn(testEmail, password, uid));
  const nextToken = await provider.signIn(testEmail, `${password}-changed`, uid);
  assert.ok(nextToken);
  stage = 'remembered-device-custom-token';
  const restoredToken = await provider.signInRememberedOwner(uid);
  const restoredCookie = await provider.createSession(restoredToken);
  assert.equal(await provider.verifySession(restoredCookie, uid), true);
  console.log(JSON.stringify({ status: 'passed', project, passwordLogin: true, cookies: true, tamperingRejected: true, revocation: true, rememberedDevice: true }));
} catch (error) {
  console.error(JSON.stringify({ status: 'failed', stage, code: (error as { code?: string }).code || 'CHECK_FAILED' }));
  process.exitCode = 1;
} finally {
  try {
    // Look up the exact randomly generated identity before cleanup, including
    // the case where creation succeeded remotely but its response was lost.
    const { body } = await admin.post(`projects/${project}/accounts:lookup`, { localId: [uid] }, hidden);
    const user = body.users?.find((value: { localId: string; email: string }) => value.localId === uid && value.email === testEmail);
    if (user) {
      await admin.post(`projects/${project}/accounts:delete`, { localId: uid }, hidden);
      console.log('Temporary test account deleted; no restaurant accounts changed.');
    } else if (created) throw Error('Test account cleanup not confirmed.');
  } catch { console.error(`Check cleanup for temporary UID ${uid}.`); process.exitCode = 1; }
  if (keyName) {
    try { await iam.delete(keyName, hidden); console.log('Temporary test credential revoked.'); }
    catch { console.error(`Check revocation for temporary key ${keyName}.`); process.exitCode = 1; }
  }
}
