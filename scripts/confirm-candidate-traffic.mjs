import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

const credential = JSON.parse(execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'auth', 'token', '--json'], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_WRITE_LOGS: 'false', WRANGLER_SEND_METRICS: 'false' },
}));
const base = 'https://api.cloudflare.com/client/v4/accounts/088309af758852fcbfc714c622dff11d/workers/scripts/qr-menu-ec';
async function read(path) {
  const response = await fetch(base + path, { headers: { Authorization: `Bearer ${credential.token}` }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw Error(`Cloudflare read HTTP ${response.status}`);
  const result = await response.json();
  if (!result.success) throw Error('Cloudflare read failed');
  return result.result;
}
const candidate = 'fcea08f9-90ed-498c-b79f-6538ff8d6444';
const production = '62bff004-11c0-4fa7-9047-b5a26a9cc0f1';
const [deployment, version] = await Promise.all([read('/deployments'), read(`/versions/${candidate}`)]);
const active = deployment.deployments[0].versions;
const values = version.resources.bindings;
const configured = [
  ['AUTH_PROVIDER', 'firebase'], ['FIREBASE_PROJECT_ID', 'qr-menu-6981a'],
  ['DATA_PROVIDER', 'firestore'], ['FIRESTORE_PROJECT_ID', 'qr-menu-6981a'],
  ['FIRESTORE_REMOTE_ENABLED', 'true'], ['FCM_ENABLED', 'false'], ['MAINTENANCE_MODE', 'false'],
].every(([name, expected]) => values.some(binding => binding.name === name && binding.text === expected));
const secretsPresent = ['FIREBASE_SERVICE_ACCOUNT', 'FIRESTORE_SERVICE_ACCOUNT', 'DATA_ENCRYPTION_KEY'].every(name => values.some(binding => binding.name === name && binding.type === 'secret_text'));
const result = {
  checkedAt: new Date().toISOString(), candidate, candidateTrafficPercent: active.find(row => row.version_id === candidate)?.percentage || 0,
  production, productionTrafficPercent: active.find(row => row.version_id === production)?.percentage || 0,
  candidateConfigurationCorrect: configured && secretsPresent,
  onlyPreviousProductionActive: active.length === 1 && active[0].version_id === production && active[0].percentage === 100,
  explicitRemoteWrites: 0, secretValuesDisclosed: false,
};
await writeFile('work/migration-preparation/acceptance-final-traffic.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (!result.candidateConfigurationCorrect || !result.onlyPreviousProductionActive) process.exitCode = 1;
