import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { firestoreBearer } from '../lib/firestore-credentials.ts';
const require = createRequire(import.meta.url);
const project = 'qr-menu-6981a';
const email = `qrmenu-firestore-worker@${project}.iam.gserviceaccount.com`;
const secretName = 'FIRESTORE_SERVICE_ACCOUNT';
const hidden = () => ({ skipLog: { reqBody: true, resBody: true } });
const childEnv = { ...process.env, WRANGLER_WRITE_LOGS: 'false', WRANGLER_SEND_METRICS: 'false', CI: 'true' };
let stage = 'authorization', createdKey, iam, stagedVersion;
try {
  if (!process.argv.includes('--stage-secret-only')) throw Error('Explicit staging authorization required.');
  stage = 'cloudflare-baseline';
  const credential = JSON.parse(execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'auth', 'token', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: childEnv }));
  const base = 'https://api.cloudflare.com/client/v4/accounts/088309af758852fcbfc714c622dff11d/workers/scripts/qr-menu-ec';
  async function get(path) {
    const response = await fetch(base + path, { headers: { Authorization: `Bearer ${credential.token}` }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw Error('Cloudflare read failed.');
    return (await response.json()).result;
  }
  const before = await get('/deployments');
  const active = before.deployments[0];
  if (active.versions.length !== 1 || active.versions[0].percentage !== 100) throw Error('Ambiguous active baseline.');
  const baselineId = active.versions[0].version_id;
  if ((await get('/versions')).items[0].id !== baselineId) throw Error('Latest version is not active; review before staging.');
  const baseline = await get(`/versions/${baselineId}`);
  if (baseline.resources.bindings.some(b => b.name === secretName)) throw Error('Secret already exists; do not replace.');
  stage = 'google-auth';
  const auth = require('firebase-tools/lib/auth');
  await require('firebase-tools/lib/requireAuth').requireAuth({ project, nonInteractive: true, ...auth.getProjectDefaultAccount(process.cwd()) });
  const { Client } = require('firebase-tools/lib/apiv2');
  iam = new Client({ urlPrefix: 'https://iam.googleapis.com', apiVersion: 'v1' });
  const rm = new Client({ urlPrefix: 'https://cloudresourcemanager.googleapis.com', apiVersion: 'v1' });
  const resource = `projects/${project}/serviceAccounts/${email}`;
  stage = 'verify-identity-and-grants';
  const account = await iam.get(resource, hidden());
  if (account.body.disabled || account.body.email !== email) throw Error('Account mismatch.');
  const { body: policy } = await rm.post(`projects/${project}:getIamPolicy`, { options: { requestedPolicyVersion: 3 } }, hidden());
  const grants = policy.bindings.filter(b => b.members?.includes(`serviceAccount:${email}`));
  if (grants.length !== 1 || grants[0].role !== 'roles/datastore.user' || grants[0].condition) throw Error('Unexpected permissions.');
  const { body: keys } = await iam.get(`${resource}/keys`, { ...hidden(), queryParams: { keyTypes: 'USER_MANAGED' } });
  if (keys.keys?.length) throw Error('Existing key requires review; no duplicate key generated.');
  stage = 'create-key';
  const { body: key } = await iam.post(`${resource}/keys`, { privateKeyType: 'TYPE_GOOGLE_CREDENTIALS_FILE', keyAlgorithm: 'KEY_ALG_RSA_2048' }, hidden());
  createdKey = key.name;
  const secret = Buffer.from(key.privateKeyData, 'base64').toString('utf8');
  const identity = JSON.parse(secret);
  if (identity.client_email !== email || identity.project_id !== project) throw Error('Credential identity mismatch.');
  stage = 'read-only-credential-check';
  const token = firestoreBearer(project, secret);
  let verified = false;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const response = await fetch(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)`, { headers: { Authorization: `Bearer ${await token()}` }, signal: AbortSignal.timeout(15000) });
      if (response.ok) { verified = true; break; }
    } catch { /* Key propagation can be delayed; never output token errors. */ }
    if (attempt < 5) await new Promise(resolve => setTimeout(resolve, 3000));
  }
  if (!verified) throw Error('Read-only credential check failed.');
  stage = 'stage-versioned-secret';
  if (!isDeepStrictEqual(before, await get('/deployments')) || (await get('/versions')).items[0].id !== baselineId) throw Error('Concurrent version change.');
  const output = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'versions', 'secret', 'bulk', '--config', 'deployment/cloudflare/wrangler.jsonc', '--tag', 'firestore-secret-only', '--message', 'Firestore credential only; do not deploy'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: childEnv });
    let stdout = '';
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.resume();
    child.on('error', () => reject(Error('Secret staging unavailable.')));
    child.on('close', code => code === 0 ? resolve(stdout) : reject(Error('Secret staging failed.')));
    child.stdin.on('error', () => {}); child.stdin.end(JSON.stringify({ [secretName]: secret }));
  });
  stagedVersion = output.match(/Created version ([a-f0-9-]{36})/i)?.[1];
  if (!stagedVersion) throw Error('Candidate ID not confirmed.');
  stage = 'verify-candidate-and-traffic';
  const candidate = await get(`/versions/${stagedVersion}`);
  const after = await get('/deployments');
  if (!isDeepStrictEqual(before, after)) throw Error('Deployment changed.');
  if (after.deployments.some(d => d.versions.some(v => v.version_id === stagedVersion && v.percentage > 0))) throw Error('Candidate unexpectedly deployed.');
  const added = candidate.resources.bindings.filter(b => b.name === secretName);
  const others = candidate.resources.bindings.filter(b => b.name !== secretName);
  const sorted = rows => [...rows].sort((a, b) => a.name.localeCompare(b.name));
  if (added.length !== 1 || added[0].type !== 'secret_text' || !isDeepStrictEqual(sorted(others), sorted(baseline.resources.bindings))) throw Error('Unexpected binding changes.');
  console.log(JSON.stringify({ secret: secretName, stored: true, credentialReadCheckPassed: true, candidateVersion: stagedVersion,
    candidateTrafficPercent: 0, activeVersion: baselineId, activeTrafficPercent: 100, deploymentUnchanged: true,
    otherBindingsUnchanged: true, authAccountModified: false, secretPrintedOrSavedLocally: false }, null, 2));
  createdKey = undefined;
} catch (error) {
  let revoked = null;
  if (createdKey && iam) { try { await iam.delete(createdKey, hidden()); revoked = true; } catch { revoked = false; } }
  console.error(JSON.stringify({ completed: false, stage, candidateVersion: stagedVersion || null, newKeyRevoked: revoked, httpStatus: error?.status || null, noSecretDisclosed: true }));
  process.exitCode = 1;
}
