import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// Read-only inventory. Credentials and Worker source are never printed or saved.
const credential = JSON.parse(execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'auth', 'token', '--json'], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, WRANGLER_WRITE_LOGS: 'false', WRANGLER_SEND_METRICS: 'false' },
}));
if (!credential.token) throw Error('Bearer authentication required.');
const worker = 'qr-menu-ec';
const base = `https://api.cloudflare.com/client/v4/accounts/088309af758852fcbfc714c622dff11d/workers/scripts/${worker}`;
async function get(path) {
  const response = await fetch(base + path, { headers: { Authorization: `Bearer ${credential.token}` } });
  if (!response.ok) throw Error(`Read failed (${response.status}).`);
  return response;
}
async function active() { return (await (await get('/deployments')).json()).result.deployments[0]; }
async function latest() { return (await (await get('/versions')).json()).result.items[0]; }
const deployment = await active();
if (deployment.versions.length !== 1 || deployment.versions[0].percentage !== 100) throw Error('Multiple active versions require separate inventories.');
const versionId = deployment.versions[0].version_id;
if ((await latest()).id !== versionId) throw Error('Latest content is not the active version; cannot attribute its checksum safely.');
const version = (await (await get(`/versions/${versionId}`)).json()).result;
const parts = await (await get('/content/v2')).formData();
const modules = [];
for (const [name, part] of parts) {
  if (typeof part === 'string') throw Error('Unexpected text part; review inventory.');
  const bytes = Buffer.from(await part.arrayBuffer());
  modules.push({ name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
if ((await active()).id !== deployment.id || (await latest()).id !== versionId) throw Error('Concurrent version change; repeat inventory.');
if (!modules.length) throw Error('No modules received.');
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), worker, deploymentId: deployment.id, versionId,
  trafficPercent: 100, deployedAt: deployment.created_on, tag: version.annotations?.['workers/tag'], modules,
  scope: 'SHA-256 of downloaded Worker modules; static assets, D1 and R2 not included', changedProduction: false }, null, 2));
