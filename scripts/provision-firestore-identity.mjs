import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
const require = createRequire(import.meta.url);
const project = 'qr-menu-6981a';
const accountId = 'qrmenu-firestore-worker';
const email = `${accountId}@${project}.iam.gserviceaccount.com`;
const member = `serviceAccount:${email}`;
const role = 'roles/datastore.user';
const hidden = () => ({ skipLog: { reqBody: true, resBody: true } });
let stage = 'authentication', accountCreated = false, grantChanged = false;
try {
  const verifyOnly = process.argv.includes('--verify');
  if (!verifyOnly && !process.argv.includes('--apply-account-only')) throw Error('Explicit account-only authorization required.');
  const auth = require('firebase-tools/lib/auth');
  await require('firebase-tools/lib/requireAuth').requireAuth({ project, nonInteractive: true, ...auth.getProjectDefaultAccount(process.cwd()) });
  const { Client } = require('firebase-tools/lib/apiv2');
  const iam = new Client({ urlPrefix: 'https://iam.googleapis.com', apiVersion: 'v1' });
  const rm = new Client({ urlPrefix: 'https://cloudresourcemanager.googleapis.com', apiVersion: 'v1' });
  const resource = `projects/${project}/serviceAccounts/${email}`;
  stage = 'read-account';
  let account = await iam.get(resource, { ...hidden(), resolveOnHTTPError: true });
  if (![200, 404].includes(account.status)) throw Error('Account inventory failed.');
  if (verifyOnly && account.status !== 200) throw Error('Account not yet visible.');
  stage = 'read-policy';
  const { body: original } = await rm.post(`projects/${project}:getIamPolicy`, { options: { requestedPolicyVersion: 3 } }, hidden());
  const existing = (original.bindings || []).filter(b => b.members?.includes(member));
  if (existing.some(b => b.role !== role || b.condition)) throw Error('Unexpected existing privileges.');
  stage = 'read-role';
  const { body: roleDefinition } = await iam.get(role, hidden());
  if (!roleDefinition.includedPermissions?.length || roleDefinition.includedPermissions.some(p => /^(firebaseauth|storage|iam)\./.test(p))) throw Error('Unexpected role scope.');
  if (account.status === 404) {
    stage = 'create-account';
    await iam.post(`projects/${project}/serviceAccounts`, { accountId,
      serviceAccount: { displayName: 'QR Menu EC Firestore Worker', description: 'Firestore data access only. Separate from Auth and FCM. Candidate not deployed.' } }, hidden());
    accountCreated = true;
  } else if (account.body.disabled) throw Error('Account is disabled.');
  if (!existing.length) {
    if (verifyOnly) throw Error('Requested grant not yet visible.');
    if (!original.etag) throw Error('Missing concurrency guard.');
    const policy = structuredClone(original);
    policy.bindings ||= [];
    const binding = policy.bindings.find(b => b.role === role && !b.condition);
    if (binding) binding.members.push(member); else policy.bindings.push({ role, members: [member] });
    stage = 'grant-requested-role';
    await rm.post(`projects/${project}:setIamPolicy`, { policy, updateMask: 'bindings,etag,version' }, hidden());
    grantChanged = true;
  }
  stage = 'verify';
  account = await iam.get(resource, hidden());
  const { body: after } = await rm.post(`projects/${project}:getIamPolicy`, { options: { requestedPolicyVersion: 3 } }, hidden());
  const assigned = (after.bindings || []).filter(b => b.members?.includes(member));
  if (account.body.email !== email || account.body.disabled || assigned.length !== 1 || assigned[0].role !== role || assigned[0].condition) throw Error('Verification failed.');
  const authMember = `serviceAccount:qrmenu-auth-worker@${project}.iam.gserviceaccount.com`;
  const authRoles = policy => (policy.bindings || []).filter(b => b.members?.includes(authMember)).map(b => ({ role: b.role, condition: b.condition || null })).sort((a, b) => a.role.localeCompare(b.role));
  if (!isDeepStrictEqual(authRoles(original), authRoles(after))) throw Error('Auth grants changed concurrently.');
  const { body: keys } = await iam.get(`${resource}/keys`, { ...hidden(), queryParams: { keyTypes: 'USER_MANAGED' } });
  console.log(JSON.stringify({ account: email, accountCreated, grantChanged, role, exactRolePermissions: roleDefinition.includedPermissions,
    onlyRequestedProjectRole: true, authGrantsUnchanged: true, userManagedKeyCount: keys.keys?.length || 0,
    keyCreated: false, cloudflareChanged: false, candidateUploaded: false, secretStored: false,
    reason: 'Storing a versioned secret creates a Worker version; awaiting clarification of no-upload restriction.' }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ completed: false, stage, accountCreated, grantChanged, httpStatus: error?.status || null,
    keyCreated: false, cloudflareChanged: false }));
  process.exitCode = 1;
}
