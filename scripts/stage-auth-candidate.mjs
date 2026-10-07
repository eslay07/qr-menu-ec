import { execFileSync } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative, extname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const parent = '22052178-361a-4546-9193-8cb47deb2f0c';
const production = '62bff004-11c0-4fa7-9047-b5a26a9cc0f1';
const account = '088309af758852fcbfc714c622dff11d';
const base = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/qr-menu-ec`;
const root = 'dist-worker';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const envText = await readFile('.env.local','utf8');
function envValue(name) { return envText.split('\n').find(line=>line.startsWith(name+'='))?.slice(name.length+1).trim().replace(/^["']|["']$/g,''); }
const apiKey=envValue('VITE_FIREBASE_API_KEY');
if(!apiKey || envValue('VITE_FIREBASE_PROJECT_ID')!=='qr-menu-6981a')throw Error('Local Firebase config mismatch');
const vars={AUTH_PROVIDER:'firebase',FIREBASE_PROJECT_ID:'qr-menu-6981a',FIREBASE_API_KEY:apiKey};
const previousReceipt=JSON.parse(await readFile('work/candidate-complete/verification.json','utf8'));
if(previousReceipt.candidateVersion!==parent)throw Error('Parent mismatch');
let stage = 'authorization', createdVersion, diagnostic;
try {
  if (!process.argv.includes('--upload-without-deploy')) throw Error('Explicit upload authorization required.');
  const credential = JSON.parse(execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'auth', 'token', '--json'], {
    encoding: 'utf8', stdio: ['ignore','pipe','pipe'], env: { ...process.env, WRANGLER_WRITE_LOGS: 'false', WRANGLER_SEND_METRICS: 'false' },
  }));
  async function api(path, init = {}) {
    const response = await fetch(base + path, { ...init, headers: { Authorization: `Bearer ${credential.token}`, ...init.headers }, signal: AbortSignal.timeout(60000) });
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      diagnostic = { httpStatus: response.status, errors: (failure.errors || []).map(e => ({ code: e.code,
        message: [credential.token, ...Object.values(vars)].reduce((s,v) => s.replaceAll(v, '[redacted]'), String(e.message || '')).slice(0,1800),
        missingLatestBinding: /inherit/i.test(e.message || ''), assetConfig: /asset/i.test(e.message || ''),
        categories: [...new Set((e.message || '').match(/metadata|binding|inherit|assets|module|compatibility|version|invalid|not found|not supported|secret|preview|size|validation|limit/gi) || [])] })) };
      throw Error('Cloudflare request failed.');
    }
    return response;
  }
  async function get(path) { return (await (await api(path)).json()).result; }
  stage = 'baseline';
  const before = await get('/deployments');
  const active = before.deployments[0];
  if (active.versions.length !== 1 || active.versions[0].version_id !== production || active.versions[0].percentage !== 100) throw Error('Production baseline changed.');
  const latestBefore=(await get('/versions')).items[0].id;
  const original = await get(`/versions/${parent}`);
  if (!original.resources.bindings.some(b => b.name === 'FIRESTORE_SERVICE_ACCOUNT' && b.type === 'secret_text')) throw Error('Candidate secret missing.');
  stage = 'local-artifacts';
  const worker = await readFile('work/candidate-complete/worker/worker.js');
  if(hash(worker)!==previousReceipt.workerSha256)throw Error('Worker differs');
  const assets = new Map();
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw Error('Unexpected asset symlink.');
      const file = join(directory, entry.name);
      if (entry.isDirectory()) { await walk(file); continue; }
      if (!entry.isFile() || entry.name.startsWith('.') || !/\.(js|css|html|svg|webp|jpg|jpeg|png|webmanifest|md|json|ico|woff2?)$/i.test(entry.name)) throw Error('Unexpected public asset type.');
      assets.set('/' + relative(root, file).replaceAll('\\', '/'), await readFile(file));
    }
  }
  await walk(root);
  const html = assets.get('/index.html')?.toString();
  const mainPath = html?.match(/<script[^>]+src="([^"]+)"/)?.[1];
  const main = assets.get(mainPath)?.toString();
  // This entrypoint was rebuilt with VITE_FCM_ENABLED explicitly disabled.
  if (!main || !main.includes('Las notificaciones push aún no están habilitadas en este entorno') || main.includes('push/device') || main.includes('VITE_FCM_ENABLED')) throw Error('Disabled FCM build not verified.');
  if (!worker.includes('FIRESTORE_REMOTE_ENABLED') || !worker.includes('FIRESTORE_SERVICE_ACCOUNT')) throw Error('Worker is not the migration build.');
  const manifest = {}, byHash = new Map();
  const types = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.md': 'text/markdown', '.json': 'application/json' };
  for (const [path, bytes] of assets) {
    const key = hash(bytes.toString('base64') + extname(path).slice(1)).slice(0,32);
    manifest[path] = { hash: key, size: bytes.length };
    byHash.set(key, { bytes, type: types[extname(path)] || 'application/octet-stream' });
  }
  if(hash(JSON.stringify(manifest))!==previousReceipt.assetManifestSha256)throw Error('Asset manifest differs');
  stage = 'upload-assets';
  console.log(JSON.stringify({ stage, localBuildChecked: true, assetCount: assets.size, secretValuesDisclosed: false }));
  const session = (await (await api('/assets-upload-session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ manifest }) })).json()).result;
  let completion = session.buckets.length ? null : session.jwt;
  for (const bucket of session.buckets) {
    const data = new FormData();
    for (const key of bucket) {
      const asset = byHash.get(key);
      if (!asset) throw Error('Unknown asset requested.');
      data.append(key, new Blob([asset.bytes.toString('base64')], { type: asset.type }), key);
    }
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/assets/upload?base64=true`, { method: 'POST', headers: { Authorization: `Bearer ${session.jwt}` }, body: data, signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw Error('Asset upload failed.');
    const result = (await response.json()).result;
    if (result.jwt) completion = result.jwt;
  }
  if (!completion) throw Error('Asset completion not confirmed.');
  stage = 'upload-version';
  if (!isDeepStrictEqual(before, await get('/deployments')) || (await get('/versions')).items[0].id !== latestBefore) throw Error('Concurrent configuration change.');
  const bindings = original.resources.bindings.filter(b => !Object.hasOwn(vars, b.name)).map(({ name }) => ({ name, type: 'inherit', version_id:parent }));
  for (const [name, text] of Object.entries(vars)) bindings.push({ name, type: 'plain_text', text });
  const form = new FormData();
  form.append('worker.js', new Blob([worker], { type: 'application/javascript+module' }), 'worker.js');
  form.append('metadata', JSON.stringify({ main_module: 'worker.js',
    compatibility_date: original.resources.script_runtime.compatibility_date,
    compatibility_flags: original.resources.script_runtime.compatibility_flags,
    // Runtime metadata contains serve_directly, the internal inverse of
    // run_worker_first. It is not an upload option; do not send both.
    bindings, assets: { jwt: completion, config: { run_worker_first: true,
      ...(original.resources.script_runtime.assets?.html_handling ? { html_handling: original.resources.script_runtime.assets.html_handling } : {}),
      ...(original.resources.script_runtime.assets?.not_found_handling ? { not_found_handling: original.resources.script_runtime.assets.not_found_handling } : {}),
    } },
    annotations: { 'workers/tag': 'firestore-candidate-ready', 'workers/message': 'Auth config only; exact 22052178 bindings inherited; NO TRAFFIC' },
  }));
  const result = (await (await api('/versions?bindings_inherit=strict', { method: 'POST', body: form })).json()).result;
  createdVersion = result.id;
  stage = 'verify-upload';
  const checked = await get(`/versions/${createdVersion}`);
  const checks = Object.entries(vars).map(([name, expected]) => {
    const b = checked.resources.bindings.find(b => b.name === name);
    return { name, exists: !!b, correct: b?.type === 'plain_text' && b.text === expected };
  });
  const secret = checked.resources.bindings.find(b => b.name === 'FIRESTORE_SERVICE_ACCOUNT');
  checks.push({ name: 'FIRESTORE_SERVICE_ACCOUNT', exists: !!secret, correct: secret?.type === 'secret_text' });
  const sort = rows => [...rows].sort((a,b) => a.name.localeCompare(b.name));
  if (!checks.every(c => c.correct) || !isDeepStrictEqual(sort(checked.resources.bindings.filter(b => !Object.hasOwn(vars,b.name))), sort(original.resources.bindings.filter(b => !Object.hasOwn(vars,b.name))))) throw Error('Binding verification failed.');
  if ((await get('/versions')).items[0].id !== createdVersion) throw Error('Concurrent newer version.');
  const content = await (await api('/content/v2')).formData();
  const uploadedWorker = content.get('worker.js');
  if (!uploadedWorker || hash(Buffer.from(await uploadedWorker.arrayBuffer())) !== hash(worker)) throw Error('Uploaded Worker checksum differs.');
  const after = await get('/deployments');
  if (!isDeepStrictEqual(before, after) || (await get('/versions')).items[0].id !== createdVersion) throw Error('Concurrent deployment/version change.');
  const receipt = { checkedAt: new Date().toISOString(), previousCandidate: parent, candidateVersion: createdVersion, checks,
    buildUploaded: true, browserFcmDisabled: true, assets: assets.size, assetManifestSha256: hash(JSON.stringify(manifest)),
    browserEntrySha256: hash(assets.get(mainPath)), workerSha256: hash(worker),
    candidateTrafficPercent: 0, activeVersion: production, activeTrafficPercent: 100, deploymentUnchanged: true,
    otherBindingsPreserved: true, acceptanceTestsRun: false, codeAndAssetsUnchanged: true };
  await writeFile('work/migration-preparation/auth-candidate-version.json', JSON.stringify(receipt,null,2), { flag: 'wx' });
  console.log(JSON.stringify(receipt,null,2));
} catch { console.error(JSON.stringify({ complete: false, stage, diagnostic, createdVersion: createdVersion || null, deploymentRequested: false, valuesDisclosed: false })); process.exitCode = 1; }
