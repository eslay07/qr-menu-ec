import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative, extname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

if (process.argv[2] !== '--upload-authorized') throw Error('Explicit authorized upload required.');
const account = '088309af758852fcbfc714c622dff11d';
const previous = 'f8544df4-c2a5-495f-8665-f41faecbb1b0';
const base = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/qr-menu-ec`;
const site = 'https://qr-menu-ec.consola.workers.dev';
const root = 'work/session-ui-hotfix/source/dist-worker';
const digest = value => createHash('sha256').update(value).digest('hex');
const auth = JSON.parse(execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'auth', 'token', '--json'], { encoding: 'utf8', stdio: ['ignore','pipe','pipe'], env: { ...process.env, WRANGLER_WRITE_LOGS: 'false', WRANGLER_SEND_METRICS: 'false' } }));
async function api(path, init = {}) {
  const response = await fetch(base + path, { ...init, headers: { Authorization: `Bearer ${auth.token}`, ...init.headers } });
  if (!response.ok) throw Error(`Cloudflare status ${response.status}`);
  return response;
}
const active = (await (await api('/deployments')).json()).result.deployments[0];
if (active.versions.length !== 1 || active.versions[0].version_id !== previous) throw Error('Unexpected active version.');
const original = (await (await api(`/versions/${previous}`)).json()).result;
const latest = (await (await api('/versions')).json()).result.items[0];
if (latest.id !== previous) throw Error('Newer undeployed version: stop for inspection.');
const oldHtml = await (await fetch(site + '/owner')).text();
const newHtml = await readFile(join(root, 'index.html'), 'utf8');
const oldJs = '/assets/index-DUSrZeRp.js', newJs = '/assets/index-CG5hAKz4.js';
if (oldHtml.replace(oldJs, newJs) !== newHtml) throw Error('Unexpected HTML change.');
const assets = new Map();
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) { await walk(file); continue; }
    const path = '/' + relative(root, file).replaceAll('\\', '/');
    let bytes = await readFile(file);
    if (path !== '/index.html' && path !== newJs) {
      const response = await fetch(site + path);
      if (!response.ok) throw Error(`Cannot preserve ${path}`);
      const remote = Buffer.from(await response.arrayBuffer());
      if (path.endsWith('.css') && digest(bytes) !== digest(remote)) throw Error(`CSS differs: ${path}`);
      bytes = remote; // Preserve all unrelated deployed assets byte-for-byte, not the local copies.
    }
    assets.set(path, bytes);
  }
}
await walk(root);
const oldResponse = await fetch(site + oldJs);
if (!oldResponse.ok) throw Error('Missing old entrypoint.');
assets.set(oldJs, Buffer.from(await oldResponse.arrayBuffer())); // Retain cached page compatibility.
const manifest = {}, byHash = new Map();
const types = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json', '.md': 'text/markdown' };
for (const [path, bytes] of assets) {
  const hash = digest(bytes.toString('base64') + extname(path).slice(1)).slice(0,32);
  manifest[path] = { hash, size: bytes.length };
  byHash.set(hash, { bytes, type: types[extname(path)] || 'application/octet-stream' });
}
const content = await (await api('/content/v2')).formData();
const worker = content.get('worker.js');
if (!worker || digest(Buffer.from(await worker.arrayBuffer())) !== '92632b8d50bcf40b5502d816a1aa7714e0d2a60f9b275c27aed32695d1fade06') throw Error('Backend differs from verified session hotfix.');
const session = (await (await api('/assets-upload-session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ manifest }) })).json()).result;
let completion = session.buckets.length ? null : session.jwt;
for (const bucket of session.buckets) {
  const data = new FormData();
  for (const hash of bucket) {
    const item = byHash.get(hash);
    if (!item) throw Error('Unknown asset hash requested.');
    data.append(hash, new Blob([item.bytes.toString('base64')], { type: item.type }), hash);
  }
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/assets/upload?base64=true`, { method: 'POST', headers: { Authorization: `Bearer ${session.jwt}` }, body: data });
  if (!response.ok) throw Error(`Asset upload failed: ${response.status}`);
  const result = (await response.json()).result;
  if (result.jwt) completion = result.jwt;
}
if (!completion) throw Error('No completed asset receipt.');
const upload = new FormData();
upload.append('worker.js', worker, 'worker.js');
upload.append('metadata', JSON.stringify({
  main_module: 'worker.js', compatibility_date: original.resources.script_runtime.compatibility_date, compatibility_flags: original.resources.script_runtime.compatibility_flags,
  bindings: original.resources.bindings.map(({name}) => ({ name, type: 'inherit' })),
  assets: { jwt: completion, config: { run_worker_first: true } },
  annotations: { 'workers/tag': 'session-loading-fix', 'workers/message': 'Fix authenticated panel loading loop only; backend unchanged' },
}));
if ((await (await api('/deployments')).json()).result.deployments[0].id !== active.id) throw Error('Concurrent deployment.');
const result = (await (await api('/versions?bindings_inherit=strict', { method: 'POST', body: upload })).json()).result;
const checked = (await (await api(`/versions/${result.id}`)).json()).result;
const normalizeRuntime = value => ({ ...value, assets: { html_handling: 'auto-trailing-slash', not_found_handling: 'none', ...value.assets } });
if (!isDeepStrictEqual(checked.resources.bindings, original.resources.bindings) || !isDeepStrictEqual(normalizeRuntime(checked.resources.script_runtime), normalizeRuntime(original.resources.script_runtime))) throw Error(`Review candidate ${result.id}; configuration mismatch, not deployed.`);
console.log(JSON.stringify({ uploadedVersion: result.id, previous, assets: assets.size, changed: ['/index.html', newJs], backendUnchanged: true, configIdentical: true, deployed: false }));
