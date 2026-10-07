import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const project = 'qr-menu-6981a';
const hidden = { skipLog: { reqBody: true, resBody: true } };
let stage = 'authentication';
try {
  const auth = require('firebase-tools/lib/auth');
  await require('firebase-tools/lib/requireAuth').requireAuth({ project, nonInteractive: true, ...auth.getProjectDefaultAccount(process.cwd()) });
  const { Client } = require('firebase-tools/lib/apiv2');
  const rm = new Client({ urlPrefix: 'https://cloudresourcemanager.googleapis.com', apiVersion: 'v1' });
  const iam = new Client({ urlPrefix: 'https://iam.googleapis.com', apiVersion: 'v1' });
  stage = 'read-policy';
  const { body: policy } = await rm.post(`projects/${project}:getIamPolicy`, { options: { requestedPolicyVersion: 3 } }, { ...hidden });
  const authMember = `serviceAccount:qrmenu-auth-worker@${project}.iam.gserviceaccount.com`;
  const bindings = (policy.bindings || []).filter(row => row.members?.includes(authMember));
  console.log(JSON.stringify({
    authAccountOnlyAuthProjectRole: bindings.length > 0 && bindings.every(b => b.role === 'roles/firebaseauth.admin' && !b.condition),
    changedIAM: false, valuesDisclosed: false }));
  stage = 'read-firestore-account';
  const account = await iam.get(`projects/${project}/serviceAccounts/qrmenu-firestore-worker@${project}.iam.gserviceaccount.com`, { ...hidden, resolveOnHTTPError: true });
  console.log(JSON.stringify({ dedicatedFirestoreAccountExists: account.status === 200 ? true : account.status === 404 ? false : null, httpStatus: account.status, changedIAM: false }));
} catch (error) { console.error(JSON.stringify({ verified: false, stage, httpStatus: error?.status ?? null, requiresLogin: /login|credential|auth/i.test(String(error?.message || '')), changedIAM: false })); process.exitCode = 1; }
