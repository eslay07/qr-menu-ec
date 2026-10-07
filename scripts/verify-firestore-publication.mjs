// Read-only live probes. Never create test documents in the remote database.
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const project = 'qr-menu-6981a';
const probes = [];
for (const [path, expected] of [
  ['publicMenus/publication-check', 404],
  ['restaurants/publication-check', 403],
  ['users/publication-check', 403],
  ['rateLimits/publication-check', 403],
  ['auditEvents/publication-check', 403],
  ['hostnames/publication-check', 403],
  ['restaurants/publication-check/settings/general', 403],
]) {
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/${path}`);
  probes.push({ path, expected, actual: response.status, passed: response.status === expected });
  await response.arrayBuffer();
}

// Capture credentials privately; output only deployment metadata.
const credential = JSON.parse(execFileSync(process.execPath,
  ['node_modules/wrangler/bin/wrangler.js', 'auth', 'token', '--json'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_WRITE_LOGS: 'false', WRANGLER_SEND_METRICS: 'false' } }));
const token = credential.token;
if (!token) throw new Error('Cloudflare credential unavailable');
const base = 'https://api.cloudflare.com/client/v4/accounts/088309af758852fcbfc714c622dff11d/workers/scripts/qr-menu-ec';
async function read(path) {
  const response = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const payload = await response.json();
  if (!response.ok || !payload.success) throw new Error('Cloudflare read failed');
  return payload.result;
}
const deploymentResult = await read('/deployments');
const deployments = deploymentResult.deployments ?? deploymentResult;
if (!Array.isArray(deployments)) throw new Error('Unexpected deployment response');
const latest = [...deployments].sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on))[0];
const activeId = '62bff004-11c0-4fa7-9047-b5a26a9cc0f1';
const candidateId = '22052178-361a-4546-9193-8cb47deb2f0c';
const versions = latest?.versions ?? [];
const active = await read(`/versions/${activeId}`);
const maintenanceEnabled = (active.resources?.bindings ?? []).some(binding => binding.name === 'MAINTENANCE_MODE' && binding.text === 'true');
const productionUnchanged = versions.length === 1 && versions[0].version_id === activeId && versions[0].percentage === 100 && !maintenanceEnabled;
const result = {
  checkedAt: new Date().toISOString(), probes,
  production: { activeId, versions, candidateId, candidateTraffic: versions.find(v => v.version_id === candidateId)?.percentage ?? 0, maintenanceEnabled, unchanged: productionUnchanged },
  documentWrites: 0, workerWrites: 0,
  passed: probes.every(probe => probe.passed) && productionUnchanged,
};
await mkdir('work/migration-preparation', { recursive: true });
await writeFile('work/migration-preparation/publication-probes.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exitCode = 1;
