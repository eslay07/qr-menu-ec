import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const require = createRequire(import.meta.url);
const project = 'qr-menu-6981a';
const accountId = 'qrmenu-auth-worker';
const email = `${accountId}@${project}.iam.gserviceaccount.com`;
const config = 'deployment/cloudflare/wrangler.jsonc';
const secretName = 'FIREBASE_SERVICE_ACCOUNT';

if (process.argv[2] !== '--apply') throw Error('Requires --apply and explicit operator authorization.');

async function wrangler(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args, '--config', config], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, WRANGLER_WRITE_LOGS: 'false', WRANGLER_SEND_METRICS: 'false', CI: 'true' },
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    // Never print stderr: a provider/tool error might contain credential material.
    child.stderr.resume();
    child.on('error', () => reject(Error('Cannot launch Wrangler. No credential output was printed.')));
    child.on('close', code => code === 0 ? resolve(output) : reject(Error(`Wrangler exited ${code}; secret provisioning not confirmed.`)));
    child.stdin.on('error', () => {});
    child.stdin.end(input || '');
  });
}
const auth = require('firebase-tools/lib/auth');
await require('firebase-tools/lib/requireAuth').requireAuth({ project, nonInteractive: true, ...auth.getProjectDefaultAccount(process.cwd()) });
const { Client } = require('firebase-tools/lib/apiv2');
const iam = new Client({ urlPrefix: 'https://iam.googleapis.com', apiVersion: 'v1' });
const rm = new Client({ urlPrefix: 'https://cloudresourcemanager.googleapis.com', apiVersion: 'v1' });
const hidden = { skipLog: { reqBody: true, resBody: true } };
const resource = `projects/${project}/serviceAccounts/${email}`;
let createdKey;
try {
  const listed = await wrangler(['secret', 'list']);
  const existingSecrets = JSON.parse(listed.slice(listed.indexOf('['), listed.lastIndexOf(']') + 1));
  if (existingSecrets.some(item => item.name === secretName)) {
    console.log(JSON.stringify({ status: 'already-present', secret: secretName, changed: false }));
    process.exit(0);
  }
  const response = await iam.get(resource, { ...hidden, resolveOnHTTPError: true });
  if (response.status === 404) {
    await iam.post(`projects/${project}/serviceAccounts`, {
      accountId, serviceAccount: { displayName: 'QR Menu EC — Auth Worker', description: 'Firebase Authentication only; QR Menu EC Worker.' },
    }, hidden);
  } else if (response.status !== 200) throw Error('Cannot read the service account.');

  const { body: policy } = await rm.post(`projects/${project}:getIamPolicy`, { options: { requestedPolicyVersion: 3 } }, hidden);
  const member = `serviceAccount:${email}`;
  const role = 'roles/firebaseauth.admin';
  policy.bindings ||= [];
  if (policy.bindings.some(binding => binding.members?.includes(member) && binding.role !== role))
    throw Error('Existing service account has unrelated roles; stopped for review.');
  if (!policy.bindings.some(binding => binding.role === role && !binding.condition && binding.members?.includes(member))) {
    if (!policy.etag) throw Error('Missing IAM etag; cannot update safely.');
    const binding = policy.bindings.find(binding => binding.role === role && !binding.condition);
    if (binding) binding.members.push(member);
    else policy.bindings.push({ role, members: [member] });
    await rm.post(`projects/${project}:setIamPolicy`, { policy, updateMask: 'bindings,etag,version' }, hidden);
  }

  const { body: credential } = await iam.post(`${resource}/keys`, {
    privateKeyType: 'TYPE_GOOGLE_CREDENTIALS_FILE', keyAlgorithm: 'KEY_ALG_RSA_2048',
  }, hidden);
  createdKey = credential.name;
  const secret = Buffer.from(credential.privateKeyData, 'base64').toString('utf8');
  const parsed = JSON.parse(secret);
  if (parsed.project_id !== project || parsed.client_email !== email) throw Error('Generated credential identity mismatch.');
  await wrangler(['secret', 'put', secretName], secret);
  const verified = await wrangler(['secret', 'list']);
  const secrets = JSON.parse(verified.slice(verified.indexOf('['), verified.lastIndexOf(']') + 1));
  if (!secrets.some(item => item.name === secretName)) throw Error('Secret was not confirmed.');
  console.log(JSON.stringify({ status: 'configured', project, serviceAccount: email, role, secret: secretName, authProviderActivated: false }));
} catch (error) {
  if (createdKey) {
    try { await iam.delete(createdKey, hidden); console.error('New key revoked after unsuccessful provisioning.'); }
    catch { console.error('ATTENTION: revocation of the new key could not be confirmed. Inspect the named service account.'); }
  }
  // Avoid serializing provider errors (may include request bodies or keys).
  console.error('Provisioning did not complete. No secret material was written to disk or printed.');
  if (error instanceof Error && /^(Wrangler|Cannot|Existing|Missing|Generated|Secret)/.test(error.message)) console.error(error.message);
  process.exitCode = 1;
}
