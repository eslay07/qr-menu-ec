import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const project = 'qr-menu-6981a';
const hidden = { skipLog: { reqBody: true, resBody: true }, resolveOnHTTPError: true };
let stage = 'authentication';
try {
  const auth = require('firebase-tools/lib/auth');
  await require('firebase-tools/lib/requireAuth').requireAuth({ project, nonInteractive: true, ...auth.getProjectDefaultAccount(process.cwd()) });
  stage = 'read-only-api';
  const { Client } = require('firebase-tools/lib/apiv2');
  const safe = promise => promise.catch(error => ({ status: typeof error?.status === 'number' ? error.status : 0, body: {}, diagnostic: String(error?.message || 'request failed').replace(/[A-Za-z0-9_=-]{40,}/g, '[redacted]').slice(0, 250) }));
  const read = (origin, path) => safe(new Client({ urlPrefix: origin, apiVersion: 'v1' }).get(path, { ...hidden }));
  const [databases, billing, services, bucket] = await Promise.all([
    read('https://firestore.googleapis.com', `projects/${project}/databases`),
    read('https://cloudbilling.googleapis.com', `projects/${project}/billingInfo`),
    read('https://serviceusage.googleapis.com', `projects/${project}/services?pageSize=200&filter=state:ENABLED`),
    safe(new Client({ urlPrefix: 'https://storage.googleapis.com', apiVersion: 'storage/v1' }).get(`b/${project}.firebasestorage.app`, { ...hidden })),
  ]);
  const rm = new Client({ urlPrefix: 'https://cloudresourcemanager.googleapis.com', apiVersion: 'v1' });
  const policy = await safe(rm.post(`projects/${project}:getIamPolicy`, { options: { requestedPolicyVersion: 3 } }, { ...hidden }));
  const fcmMember = `serviceAccount:qrmenu-fcm-worker@${project}.iam.gserviceaccount.com`;
  console.log(JSON.stringify({ project,
    firestore: { status: databases.status, databases: databases.body.databases?.map(d => ({ name: d.name, type: d.type, location: d.locationId })) || [] },
    billing: { status: billing.status, enabled: billing.body.billingEnabled ?? null },
    apis: { status: services.status, enabled: services.body.services?.map(s => s.config?.name).filter(n => ['firestore.googleapis.com', 'fcm.googleapis.com', 'storage.googleapis.com', 'iam.googleapis.com'].includes(n)) || [] },
    storage: { status: bucket.status, name: bucket.body.name || null, location: bucket.body.location || null, publicAccessPrevention: bucket.body.iamConfiguration?.publicAccessPrevention || null },
    fcmGrants: policy.body.bindings?.filter(binding => binding.members?.includes(fcmMember)).map(binding => ({ role: binding.role, conditional: !!binding.condition })) || [],
    diagnostics: [databases, billing, services, bucket].map(result => result.diagnostic || { code: result.body?.error?.status || null, reasons: result.body?.error?.details?.map(d => d.reason).filter(Boolean) || [] }), changed: false,
  }));
} catch (error) {
  console.error(JSON.stringify({ stage, httpStatus: typeof error?.status === 'number' ? error.status : null, requiresLogin: /login|credential|auth/i.test(String(error?.message || '')) }));
  console.error('No se pudo completar la inspección autenticada. No se modificó configuración ni se imprimieron credenciales.');
  process.exitCode = 1;
}
