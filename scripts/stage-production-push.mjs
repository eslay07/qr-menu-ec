import { execFileSync } from 'node:child_process';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative, extname, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

// Never reads a secret: beta version inheritance preserves each original identity.
const notificationsRelease = process.argv.includes('--notifications-release');
const parent = notificationsRelease ? '29930545-7db3-4c1b-85f7-525ace3ecb15' : '724862e7-0c75-4bdd-b01a-4067891f78fe';
const fcmParent = notificationsRelease ? parent : '29ce6c0b-c3cc-4002-be09-0c603e6e9752';
const account = '088309af758852fcbfc714c622dff11d';
const root = `https://api.cloudflare.com/client/v4/accounts/${account}/workers`;
const withRecovery = process.argv.includes('--with-firebase-recovery');
const withD1 = process.argv.includes('--with-d1-documents');
if (withD1 && !withRecovery) throw Error('D1 requires the current Firebase recovery build.');
if (notificationsRelease && (!withD1 || !withRecovery)) throw Error('Notifications release must preserve the current D1 and Firebase build.');
const destination = withD1 ? JSON.parse(await readFile('work/d1-transition/destination.json','utf8')) : null;
if (withD1 && destination.databaseId !== '0c8dab0c-5e79-4272-a28c-90b00a93e676') throw Error('Unexpected D1 destination.');
const output = notificationsRelease ? 'work/notifications-release' : withD1 ? 'work/d1-production-candidate' : withRecovery ? 'work/push-mail-production-candidate' : 'work/push-production-candidate';
const sha = value => createHash('sha256').update(value).digest('hex');
if (!process.argv.includes('--stage-only')) throw Error('Use --stage-only; this script cannot deploy.');
let token;
function authenticate() {
  token = JSON.parse(execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'auth', 'token', '--json'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_WRITE_LOGS: 'false', WRANGLER_SEND_METRICS: 'false' },
  })).token;
}
authenticate();
async function api(path, init = {}, retry = true) {
  const response = await fetch(root + path, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers }, signal: AbortSignal.timeout(60000) });
  if (response.status === 401 && retry) { authenticate(); return api(path, init, false); }
  if (!response.ok) throw Error(`Cloudflare HTTP ${response.status} at ${path.split('?')[0]}`);
  const result = await response.json();
  if (!result.success) throw Error('Cloudflare operation not confirmed.');
  return result.result;
}
const base = '/scripts/qr-menu-ec';
const before = await api(base + '/deployments');
const deployed = before.deployments[0].versions;
if (deployed.length !== 1 || deployed[0].version_id !== parent || deployed[0].percentage !== 100) throw Error('Production baseline changed.');
const original = await api(`${base}/versions/${parent}`);
const fcm = await api(`${base}/versions/${fcmParent}`);
if (!fcm.resources.bindings.some(b => b.name === 'FIREBASE_FCM_SERVICE_ACCOUNT' && b.type === 'secret_text')) throw Error('FCM identity missing.');
let worker = notificationsRelease ? '' : await readFile('work/print-candidate-v2/worker.js', 'utf8');
if (!notificationsRelease) {
if (sha(worker) !== '44f0b30e17a44dcac14365c844c564eff7e06cd2d451782f2c8020bd451a6e5a') throw Error('Accepted Worker hash mismatch.');
const old = 'this.transport(`https://fcm.googleapis.com/v1/projects/${this.project}/messages:send`, {';
if (worker.split(old).length !== 2) throw Error('FCM transport patch is not unique.');
worker = worker.replace(old, 'this.transport.call(globalThis, `https://fcm.googleapis.com/v1/projects/${this.project}/messages:send`, {');
}
if (withRecovery) {
  // Wrangler resolves relative outdirs against its config directory. Use an
  // absolute path and rebuild here so staging can never read a stale bundle.
  execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','deploy','--config','deployment/cloudflare/wrangler.jsonc','--dry-run','--outdir',resolve('deployment/cloudflare/work/push-mail-worker')],{stdio:'inherit',env:{...process.env,WRANGLER_WRITE_LOGS:'false',WRANGLER_SEND_METRICS:'false'}});
  worker = await readFile('deployment/cloudflare/work/push-mail-worker/worker.js', 'utf8');
  if (!worker.includes('accounts:sendOobCode') || !worker.includes('rememberedDeviceValid') || !worker.includes('this.transport.call(globalThis,') || !worker.includes('handleOwnerRecovery')) throw Error('Recovery build guards failed.');
  if (withD1 && !worker.includes('d1://operational-documents')) throw Error('D1 build missing.');
}
const assets = new Map();
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.isFile()) assets.set('/' + relative('dist-worker', path).replaceAll('\\', '/'), await readFile(path));
    else throw Error('Unexpected asset type.');
  }
}
await walk('dist-worker');
if (!assets.has('/firebase-messaging-sw.js') || ![...assets.values()].some(bytes => bytes.includes('push/device'))) throw Error('Push-enabled browser build missing.');
const apk = await readFile('outputs/QR-Menu-EC.apk');
assets.set('/downloads/qr-menu-ec.apk', apk);
assets.set('/downloads/SHA256SUMS.txt', Buffer.from(`${sha(apk)}  qr-menu-ec.apk\n`));
const manifest = Object.fromEntries([...assets].map(([path, bytes]) => [path, { hash: sha(bytes.toString('base64') + extname(path).slice(1)).slice(0,32), size: bytes.length }]));
const types = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.txt': 'text/plain', '.apk': 'application/vnd.android.package-archive' };
const byHash = new Map([...assets].map(([path, bytes]) => [manifest[path].hash, { bytes, type: types[extname(path)] || 'application/octet-stream' }]));
const session = await api(base + '/assets-upload-session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ manifest }) });
let jwt = session.buckets.length ? null : session.jwt;
for (const bucket of session.buckets) {
  const data = new FormData();
  for (const key of bucket) { const asset = byHash.get(key); data.append(key, new Blob([asset.bytes.toString('base64')], { type: asset.type }), key); }
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/assets/upload?base64=true`, { method: 'POST', headers: { Authorization: `Bearer ${session.jwt}` }, body: data, signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw Error(`Asset upload HTTP ${response.status}`);
  const result = await response.json();
  if (!result.success) throw Error('Asset upload not confirmed.');
  if (result.result.jwt) jwt = result.result.jwt;
}
if (!jwt || !isDeepStrictEqual(before, await api(base + '/deployments'))) throw Error('Concurrent deployment detected.');
const bindings = original.resources.bindings.map(({ name }) => name === 'FCM_ENABLED' ? { name, type: 'plain_text', text: 'true' } : name === 'DATA_PROVIDER' && withD1 ? { name, type:'plain_text', text:'d1-documents' } : { name, type: 'inherit', version_id: parent });
if (withD1 && !notificationsRelease) bindings.push({name:'DOCUMENT_DB',type:'d1',id:destination.databaseId});
if (!notificationsRelease) bindings.push({ name: 'FIREBASE_FCM_SERVICE_ACCOUNT', type: 'inherit', version_id: fcmParent });
const runtime = original.resources.script_runtime;
const metadata = { main_module: 'worker.js', modules: [{ name: 'worker.js', content_type: 'application/javascript+module', content_base64: Buffer.from(worker).toString('base64') }], bindings,
  compatibility_date: runtime.compatibility_date, compatibility_flags: runtime.compatibility_flags,
  assets: { jwt, config: { run_worker_first: true, html_handling: runtime.assets?.html_handling, not_found_handling: runtime.assets?.not_found_handling } },
  annotations: { 'workers/tag': 'push-production-candidate', 'workers/message': notificationsRelease ? 'Dedicated notification center, exact event deep links and signed APK 0.8.2; zero traffic' : 'FCM receiver fix, push-enabled UI and signed APK 0.8.1; zero traffic pending physical acceptance' } };
const version = await api('/workers/qr-menu-ec/versions?deploy=false', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(metadata) });
const checked = await api(`${base}/versions/${version.id}`);
for (const binding of original.resources.bindings.filter(b => !['FCM_ENABLED', 'ASSETS', ...(withD1 ? ['DATA_PROVIDER'] : [])].includes(b.name))) {
  if (!isDeepStrictEqual(binding, checked.resources.bindings.find(b => b.name === binding.name))) throw Error(`Binding changed: ${binding.name}`);
}
if (withD1 && (!checked.resources.bindings.some(binding=>binding.name==='DATA_PROVIDER'&&binding.text==='d1-documents') || !checked.resources.bindings.some(binding=>binding.name==='DOCUMENT_DB'&&binding.id===destination.databaseId))) throw Error('D1 bindings not confirmed.');
if (!isDeepStrictEqual(before, await api(base + '/deployments'))) throw Error('Production changed.');
await mkdir(output, { recursive: true });
await writeFile(`${output}/worker.js`, worker);
const receipt = { checkedAt: new Date().toISOString(), versionId: version.id, parentVersion: parent, dataProvider:withD1?'d1-documents':'firestore', ...(withD1?{documentDatabase:destination.databaseId}:{}), fcmSecretInheritedFrom: fcmParent, fcmEnabled: true, frontendFcmEnabled: true, workerSha256: sha(worker), apkSha256: sha(apk), assetManifestSha256: sha(JSON.stringify(manifest)), productionUnchanged: true, trafficPercent: 0 };
await writeFile(`${output}/version.json`, JSON.stringify(receipt,null,2));
console.log(JSON.stringify(receipt,null,2));
