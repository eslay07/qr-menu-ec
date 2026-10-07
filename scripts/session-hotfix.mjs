import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

// Credentials remain in memory; never print provider payloads or source bundles.
const credential = JSON.parse(execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'auth', 'token', '--json'], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, WRANGLER_WRITE_LOGS: 'false', WRANGLER_SEND_METRICS: 'false' },
}));
if (!credential.token) throw Error('Bearer authentication required.');
const base = 'https://api.cloudflare.com/client/v4/accounts/088309af758852fcbfc714c622dff11d/workers/scripts/qr-menu-ec';
async function request(path, options = {}) {
  const r = await fetch(base + path, { ...options, headers: { Authorization: `Bearer ${credential.token}`, ...options.headers } });
  if (!r.ok) {
    const error = await r.json().catch(() => ({}));
    console.error(JSON.stringify({ errors: error.errors?.map(({code,message}) => ({code,message})) }));
    throw Error(`Cloudflare ${r.status} on ${path}`);
  }
  return r;
}
const digest = value => createHash('sha256').update(value).digest('hex');
const normalizeRuntime = runtime => ({ ...runtime, assets: { html_handling: 'auto-trailing-slash', not_found_handling: 'none', ...runtime.assets } });
const deployments = (await (await request('/deployments')).json()).result;
const active = deployments.deployments[0];
console.log(JSON.stringify({ activeDeployment: active.id, versions: active.versions }));
const version = (await (await request(`/versions/${active.versions[0].version_id}`)).json()).result;
const versions = (await (await request('/versions')).json()).result;
const latest = (await (await request(`/versions/${versions.items[0].id}`)).json()).result;
if (process.argv[2] === '--inspect-candidate') {
  console.log(JSON.stringify({ active: version.id, latest: latest.id, sameBackend: version.resources.script.etag === latest.resources.script.etag, runtime: version.resources.script_runtime, candidateRuntime: latest.resources.script_runtime, bindingDiffs: latest.resources.bindings.filter(binding => !isDeepStrictEqual(binding, version.resources.bindings.find(value => value.name === binding.name))).map(binding => ({ name: binding.name, type: binding.type, keys: Object.keys(binding) })), removedBindings: version.resources.bindings.filter(binding => !latest.resources.bindings.some(value => value.name === binding.name)).map(binding=>binding.name) }));
  process.exit(0);
}
console.log(JSON.stringify({ latest: latest.id, sameCode: latest.resources.script.etag === version.resources.script.etag, runtime: version.resources.script_runtime, latestRuntime: latest.resources.script_runtime, latestAnnotations: latest.annotations }));
console.log(JSON.stringify({ versionKeys: Object.keys(version), resourceKeys: Object.keys(version.resources || {}), script: version.resources?.script, bindingNames: version.resources?.bindings?.map(({name,type})=>({name,type})) }));
const settings = (await (await request('/settings')).json()).result;
console.log(JSON.stringify({ settingKeys: Object.keys(settings), bindings: settings.bindings?.map(({name,type})=>({name,type})) }));
const content = await request('/content/v2');
console.log(JSON.stringify({ contentType: content.headers.get('content-type'), main: content.headers.get('cf-worker-main-module-part') }));
const parts = await content.formData();
const upload = new FormData();
let patched = 0;
for (const [name, part] of parts) {
  if (typeof part === 'string') { console.log(JSON.stringify({ name, textPart: true })); continue; }
  const bytes = Buffer.from(await part.arrayBuffer());
  const source = bytes.toString();
  const start = source.indexOf('async function handleOwnerDevice(');
  const end = source.indexOf('\nasync function ', start + 10);
  const section = start >= 0 ? source.slice(start, end < 0 ? start + 3000 : end) : '';
  if (process.argv[2] === '--diagnose') {
    console.log(section);
    for (const marker of ['async rotateDevice(', 'async createSession(', 'async session(', 'function secureResponse(', 'const isAuthed =']) {
      const position = source.indexOf(marker);
      console.log(source.slice(position, position + 2400));
    }
    continue;
  }
  console.log(JSON.stringify({ deviceGuard: section.split('\n').filter(line=>line.includes('x-csrf-token')) }));
  console.log(JSON.stringify({ name, type: part.type, bytes: bytes.length, sha256: digest(bytes), hasDeviceHandler: start >= 0, csrfGuards: section.match(/\/\^.{0,80}\$\//g) }));
  const oldGuard = 'request.headers.get("x-csrf-token")?.length !== 64';
  const newGuard = '!/^[a-zA-Z0-9]{20,64}$/.test(request.headers.get("x-csrf-token") || "")';
  if (name !== 'worker.js' || digest(bytes) !== 'dcb13a9d18831bbfd67bf34b937b68cc722cd430e84f516e3e5ac254a5dad446') throw Error('Unexpected deployed bundle; refusing mutation.');
  if (source.split(oldGuard).length !== 2 || !section.includes(oldGuard)) throw Error('Expected unique device guard not found.');
  const candidate = source.replace(oldGuard, newGuard);
  if (candidate.replace(newGuard, oldGuard) !== source) throw Error('Patch is not reversible.');
  upload.append(name, new Blob([candidate], { type: part.type }), name);
  patched++;
  console.log(JSON.stringify({ candidateSha256: digest(candidate), replacements: 1 }));
}
if (process.argv[2] === '--upload-authorized') {
  const previous = '230a9997-9ee9-4c32-ac3a-0d1efe9f2a28';
  if (patched !== 1 || active.versions.length !== 1 || active.versions[0].version_id !== previous || active.versions[0].percentage !== 100) throw Error('Unexpected deployment.');
  if (latest.resources.script.etag !== version.resources.script.etag || !isDeepStrictEqual(normalizeRuntime(latest.resources.script_runtime), normalizeRuntime(version.resources.script_runtime))) throw Error('Latest code/runtime differs from active.');
  const runtime = version.resources.script_runtime;
  for (const binding of version.resources.bindings) {
    if (!isDeepStrictEqual(binding, latest.resources.bindings.find(value => value.name === binding.name))) throw Error('Shared binding differs; cannot safely inherit latest.');
  }
  upload.append('metadata', JSON.stringify({
    main_module: 'worker.js', compatibility_date: runtime.compatibility_date, compatibility_flags: runtime.compatibility_flags,
    bindings: version.resources.bindings.map(binding => ({ name: binding.name, type: 'inherit', version_id: 'latest' })),
    keep_assets: true, assets: { config: { run_worker_first: true } },
    annotations: { 'workers/message': 'Fix remembered-device CSRF length only; preserve active configuration', 'workers/tag': 'device-session-hotfix' },
  }));
  const stillActive = (await (await request('/deployments')).json()).result.deployments[0];
  if (stillActive.id !== active.id) throw Error('Concurrent deployment; stopped.');
  const result = (await (await request('/versions?bindings_inherit=strict', { method: 'POST', body: upload })).json()).result;
  const uploaded = (await (await request(`/versions/${result.id}`)).json()).result;
  if (!isDeepStrictEqual(uploaded.resources.bindings, version.resources.bindings) || !isDeepStrictEqual(normalizeRuntime(uploaded.resources.script_runtime), normalizeRuntime(runtime))) throw Error(`Uploaded version ${result.id} requires review: configuration differs; NOT deployed.`);
  console.log(JSON.stringify({ uploadedVersion: result.id, previousVersion: previous, configIdentical: true, deployed: false }));
}
