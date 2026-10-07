import { createRequire } from 'node:module';
import { loadEnv } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';

// One disposable Auth account; never reset the operator's actual password.
// Email is sent only to the operator's Gmail plus-alias, not any customer.
if (!process.argv.includes('--send-test-to-operator')) throw Error('Explicit test-email flag required.');
const project = 'qr-menu-6981a';
const uid = `qrmenu-recovery-qa-${crypto.randomUUID()}`;
const email = `eslay777j+qrmenuqa${Date.now()}@gmail.com`;
const require = createRequire(import.meta.url);
const auth = require('firebase-tools/lib/auth');
await require('firebase-tools/lib/requireAuth').requireAuth({ project, nonInteractive: true, ...auth.getProjectDefaultAccount(process.cwd()) });
const { getAccessToken } = require('firebase-tools/lib/apiv2');
async function admin(operation, body) {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${project}${operation}`, {
    method: 'POST', headers: { Authorization: `Bearer ${await getAccessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(Error('Auth QA operation failed'), { status: response.status, code: result.error?.status });
  return result;
}
let created = false;
const receipt = { checkedAt: new Date().toISOString(), project, accountCreated: false, providerAcceptedEmail: false, temporaryAccountDeleted: false, actualOperatorPasswordChanged: false, deliveryConfirmed: false };
try {
  const user = await admin('/accounts', { localId: uid, email, password: crypto.randomUUID() + crypto.randomUUID(), emailVerified: false });
  if (user.localId !== uid) throw Error('QA identity mismatch.');
  created = true; receipt.accountCreated = true;
  const env = loadEnv('production', process.cwd(), 'VITE_');
  if (env.VITE_FIREBASE_PROJECT_ID !== project || !env.VITE_FIREBASE_API_KEY) throw Error('Project configuration mismatch.');
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(env.VITE_FIREBASE_API_KEY)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Firebase-Locale': 'es' },
    body: JSON.stringify({ requestType: 'PASSWORD_RESET', email }), signal: AbortSignal.timeout(15000),
  });
  receipt.providerHttpStatus = response.status;
  receipt.providerAcceptedEmail = response.ok;
  if (!response.ok) throw Error('Firebase did not accept recovery email.');
} catch (error) {
  receipt.failure = { status: error.status || null, code: error.code || 'QA_UNAVAILABLE' };
  process.exitCode = 1;
} finally {
  if (created) {
    try { await admin('/accounts:delete', { localId: uid }); receipt.temporaryAccountDeleted = true; }
    catch { receipt.cleanupRequiredUid = uid; process.exitCode = 1; }
  }
  await mkdir('work/recovery-live-qa', { recursive: true });
  await writeFile('work/recovery-live-qa/result.json', JSON.stringify(receipt,null,2));
  console.log(JSON.stringify(receipt,null,2));
}
