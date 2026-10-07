import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { firestoreBearer } from '../lib/firestore-credentials.ts';
const require = createRequire(import.meta.url);
const project = 'qr-menu-6981a', accountId = 'qrmenu-fcm-worker';
const email = `${accountId}@${project}.iam.gserviceaccount.com`;
const roleId = 'qrMenuFcmSender', roleName = `projects/${project}/roles/${roleId}`;
const secretName = 'FIREBASE_FCM_SERVICE_ACCOUNT';
const hidden = () => ({ skipLog: { reqBody: true, resBody: true } });
if (!['--apply', '--verify'].includes(process.argv[2])) throw Error('Requiere autorización y --apply, o --verify VERSION_UUID.');

async function wrangler(args, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args, '--config', 'deployment/cloudflare/wrangler.jsonc'], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, WRANGLER_WRITE_LOGS: 'false', WRANGLER_SEND_METRICS: 'false', CI: 'true' },
    });
    let output = '';
    child.stdout.on('data', bytes => { output += bytes; }); child.stderr.resume();
    child.stdin.on('error', () => {}); child.stdin.end(input);
    child.on('error', () => reject(Error('Secret store unavailable.')));
    child.on('close', code => code === 0 ? resolve(output) : reject(Error('Secret storage not confirmed.')));
  });
}
let createdKey, iam, stage = 'authentication', validationResult;
try {
  const auth = require('firebase-tools/lib/auth');
  await require('firebase-tools/lib/requireAuth').requireAuth({ project, nonInteractive: true, ...auth.getProjectDefaultAccount(process.cwd()) });
  const { Client } = require('firebase-tools/lib/apiv2');
  iam = new Client({ urlPrefix: 'https://iam.googleapis.com', apiVersion: 'v1' });
  const rm = new Client({ urlPrefix: 'https://cloudresourcemanager.googleapis.com', apiVersion: 'v1' });
  if (process.argv[2] === '--verify') {
    const versionId = process.argv[3];
    if (!/^[a-f0-9-]{36}$/.test(versionId || '')) throw Error('Invalid staging version.');
    const version = JSON.parse(await wrangler(['versions', 'view', versionId, '--json']));
    const deployments = JSON.parse(await wrangler(['deployments', 'list', '--json']));
    const keys = await iam.get(`projects/${project}/serviceAccounts/${email}/keys`, { ...hidden(), queryParams: { keyTypes: 'USER_MANAGED' } });
    const role = await iam.get(roleName, hidden());
    const secretPresent = JSON.stringify(version).includes(secretName);
    const versionDeployed = JSON.stringify(deployments).includes(versionId);
    const minimalRole = JSON.stringify(role.body.includedPermissions) === JSON.stringify(['cloudmessaging.messages.create']);
    const activeKeys = (keys.body.keys || []).filter(key => !key.disabled).length;
    console.log(JSON.stringify({ versionId, secretPresent, versionDeployed, minimalRole, activeUserManagedKeys: activeKeys }));
    if (!secretPresent || versionDeployed || !minimalRole || activeKeys !== 1) process.exitCode = 1;
    process.exit(process.exitCode || 0);
  }
  // Capture deployment before adding secrets to an UNDEPLOYED version.
  stage = 'deployment-baseline';
  const before = JSON.parse(await wrangler(['deployments', 'list', '--json']));
  stage = 'minimal-role';
  const role = await iam.get(roleName, { ...hidden(), resolveOnHTTPError: true });
  if (role.status === 404) await iam.post(`projects/${project}/roles`, { roleId, role: { title: 'QR Menu FCM sender', description: 'Send/validate FCM messages only. No Auth, Firestore or Storage access.', includedPermissions: ['cloudmessaging.messages.create'], stage: 'GA' } }, hidden());
  else if (role.status !== 200 || JSON.stringify(role.body.includedPermissions) !== JSON.stringify(['cloudmessaging.messages.create']) || role.body.deleted) throw Error('Role scope mismatch.');
  stage = 'service-account';
  const resource = `projects/${project}/serviceAccounts/${email}`;
  const account = await iam.get(resource, { ...hidden(), resolveOnHTTPError: true });
  if (account.status === 404) await iam.post(`projects/${project}/serviceAccounts`, { accountId, serviceAccount: { displayName: 'QR Menu EC FCM Worker', description: 'Separate identity for messaging; migration not activated.' } }, hidden());
  else if (account.status !== 200 || account.body.disabled) throw Error('Service account unavailable.');
  stage = 'iam-policy';
  const { body: policy } = await rm.post(`projects/${project}:getIamPolicy`, { options: { requestedPolicyVersion: 3 } }, hidden());
  const member = `serviceAccount:${email}`;
  policy.bindings ||= [];
  if (policy.bindings.some(binding => binding.members?.includes(member) && binding.role !== roleName)) throw Error('Account has unrelated permissions.');
  if (!policy.bindings.some(binding => binding.role === roleName && !binding.condition && binding.members?.includes(member))) {
    if (!policy.etag) throw Error('Missing IAM concurrency guard.');
    const binding = policy.bindings.find(binding => binding.role === roleName && !binding.condition);
    if (binding) binding.members.push(member); else policy.bindings.push({ role: roleName, members: [member] });
    await rm.post(`projects/${project}:setIamPolicy`, { policy, updateMask: 'bindings,etag,version' }, hidden());
  }
  // Avoid silently creating a second long-lived key when resumed.
  stage = 'existing-key-check';
  const keys = await iam.get(`${resource}/keys`, { ...hidden(), queryParams: { keyTypes: 'USER_MANAGED' } });
  if (keys.body.keys?.length) throw Error('Existing managed key requires review before provisioning another.');
  stage = 'credential';
  const { body: key } = await iam.post(`${resource}/keys`, { privateKeyType: 'TYPE_GOOGLE_CREDENTIALS_FILE', keyAlgorithm: 'KEY_ALG_RSA_2048' }, hidden());
  createdKey = key.name;
  const secret = Buffer.from(key.privateKeyData, 'base64').toString('utf8');
  const identity = JSON.parse(secret);
  if (identity.client_email !== email || identity.project_id !== project) throw Error('Credential identity mismatch.');
  stage = 'oauth-propagation';
  const token = firestoreBearer(project, secret, 'https://www.googleapis.com/auth/firebase.messaging');
  let accessToken;
  for (let attempt = 0; attempt < 12; attempt++) {
    try { accessToken = await token(); break; }
    catch { if (attempt < 11) await new Promise(resolve => setTimeout(resolve, 5000)); }
  }
  if (!accessToken) throw Error('Credential propagation not confirmed.');
  stage = 'validate-only';
  let verified = false;
  for (let attempt = 0; attempt < 12; attempt++) {
    const response = await fetch(`https://fcm.googleapis.com/v1/projects/${project}/messages:send`, {
      method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ validate_only: true, message: { topic: `qrmenu-isolated-validation-${crypto.randomUUID()}`, data: { purpose: 'credential-check-no-delivery' } } }), signal: AbortSignal.timeout(15000),
    });
    if (response.ok) { verified = true; break; }
    const failure = await response.json().catch(() => ({}));
    validationResult = { status: response.status, code: failure.error?.status || null, reasons: failure.error?.details?.map(detail => ({ code: detail.errorCode || detail.reason || null, permission: detail.metadata?.permission || null, resource: detail.metadata?.resource || null })).filter(detail => detail.code) || [] };
    if (response.status !== 403 || attempt === 11) break;
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  if (!verified) throw Error('FCM validation not confirmed.');
  stage = 'undeployed-secret';
  const upload = await wrangler(['versions', 'secret', 'bulk', '--message', 'FCM credential staging only; do not deploy', '--tag', 'fcm-credential-staging'], JSON.stringify({ [secretName]: secret }));
  const versionId = upload.match(/(?:Version ID|version)[^a-f0-9]*([a-f0-9-]{36})/i)?.[1] || null;
  const after = JSON.parse(await wrangler(['deployments', 'list', '--json']));
  if (JSON.stringify(before) !== JSON.stringify(after)) throw Error('Deployment baseline changed; inspect before activation.');
  console.log(JSON.stringify({ status: 'validated-and-staged', project, serviceAccount: email, permission: 'cloudmessaging.messages.create', secret: secretName, versionId, productionDeploymentChanged: false, realMessageSent: false }));
  createdKey = undefined; // Credential remains only in Cloudflare secret storage.
} catch (error) {
  let revoked = null;
  if (createdKey && iam) { try { await iam.delete(createdKey, hidden()); revoked = true; } catch { revoked = false; } }
  console.error(JSON.stringify({ status: 'not-complete', stage, validationResult, httpStatus: typeof error?.status === 'number' ? error.status : null, newKeyRevoked: revoked, serviceAccount: email, noCredentialPrinted: true }));
  process.exitCode = 1;
}
