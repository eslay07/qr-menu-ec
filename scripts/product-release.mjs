import { execFileSync } from 'node:child_process';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { cf } from './d1-transition-operator.mjs';
import { assetDescriptor, assetPart, assetMime } from './release-assets.mjs';

const output = 'work/product-release';
const base = '/workers/scripts/qr-menu-ec';
const hash = value => createHash('sha256').update(value).digest('hex');
const mode = process.argv[2];
const origin = 'https://qr-menu-ec.consola.workers.dev';
if (!['--stage', '--activate', '--rollback'].includes(mode)) throw Error('Select stage, activate or rollback.');
await mkdir(output, { recursive: true });
async function active() { return (await cf(base + '/deployments')).deployments[0].versions; }
if (mode === '--stage') {
  const before = await active();
  if (before.length !== 1 || before[0].percentage !== 100) throw Error('Ambiguous production baseline.');
  const parent = before[0].version_id;
  const original = await cf(base + '/versions/' + parent);
  await writeFile(output + '/baseline.json', JSON.stringify({ versionId: parent, runtime: original.resources.script_runtime, bindings: original.resources.bindings.filter(b => b.type !== 'secret_text') }, null, 2));
  execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'deploy', '--config', 'deployment/cloudflare/wrangler.jsonc', '--dry-run', '--outdir', resolve(output, 'bundle')], { stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false' } });
  const worker = await readFile(output + '/bundle/worker.js');
  const assets = new Map();
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) assets.set('/' + relative('dist-worker', file).replaceAll('\\', '/'), await readFile(file));
    }
  }
  await walk('dist-worker');
  // Preserve the currently signed Android distribution when native code is unchanged.
  for (const path of ['/downloads/qr-menu-ec.apk', '/downloads/SHA256SUMS.txt']) {
    let bytes;
    for (let attempt=0;attempt<3;attempt++) {
      try {
        const response = await fetch(origin + path, { signal: AbortSignal.timeout(60000) });
        if (!response.ok) throw Error('Cannot preserve signed distribution.');
        bytes = Buffer.from(await response.arrayBuffer());
        break;
      } catch(error) { if(attempt===2)throw error; console.log('Retrying distribution read.'); }
    }
    assets.set(path, bytes);
  }
  // Opt-in replacement only after the operator verifies the existing signing identity.
  if (process.env.QR_MENU_RELEASE_APK) {
    const apk = await readFile(resolve(process.env.QR_MENU_RELEASE_APK));
    if (!process.env.QR_MENU_RELEASE_APK_SHA256 || hash(apk) !== process.env.QR_MENU_RELEASE_APK_SHA256) throw Error('New signed APK checksum not verified.');
    assets.set('/downloads/qr-menu-ec.apk', apk);
    assets.set('/downloads/SHA256SUMS.txt', Buffer.from(`${hash(apk)}  qr-menu-ec.apk\n`));
  }
  const apkHash = hash(assets.get('/downloads/qr-menu-ec.apk'));
  if (!assets.get('/downloads/SHA256SUMS.txt').toString().includes(apkHash)) throw Error('Distribution checksum mismatch.');
  const manifest = Object.fromEntries([...assets].map(([path, bytes]) => [path, assetDescriptor(path,bytes)]));
  const byHash = new Map([...assets].map(([path, bytes]) => [manifest[path].hash, {path,bytes}]));
  const session = await cf(base + '/assets-upload-session', 'POST', { manifest });
  let jwt = session.buckets.length ? null : session.jwt;
  for (const bucket of session.buckets) {
    const data = new FormData();
    for (const key of bucket) {const asset=byHash.get(key);data.append(key,assetPart(asset.path,asset.bytes),key);}
    const response = await fetch('https://api.cloudflare.com/client/v4/accounts/088309af758852fcbfc714c622dff11d/workers/assets/upload?base64=true', { method: 'POST', headers: { Authorization: `Bearer ${session.jwt}` }, body: data, signal: AbortSignal.timeout(60000) });
    const result = await response.json();
    if (!response.ok || !result.success) throw Error('Asset upload failed.');
    if (result.result.jwt) jwt = result.result.jwt;
  }
  if (!jwt || !isDeepStrictEqual(before, await active())) throw Error('Production changed during staging.');
  const runtime = original.resources.script_runtime;
  const candidate = await cf('/workers/workers/qr-menu-ec/versions?deploy=false', 'POST', {
    main_module: 'worker.js', modules: [{ name: 'worker.js', content_type: 'application/javascript+module', content_base64: worker.toString('base64') }],
    bindings: original.resources.bindings.map(({name}) => ({ name, type: 'inherit', version_id: parent })),
    compatibility_date: runtime.compatibility_date, compatibility_flags: runtime.compatibility_flags,
    assets: { jwt, config: { run_worker_first: true, html_handling: runtime.assets?.html_handling, not_found_handling: runtime.assets?.not_found_handling } },
    annotations: { 'workers/message': 'Product readiness; preserved production bindings; staged with zero traffic' },
  });
  const checked = await cf(base + '/versions/' + candidate.id);
  for (const binding of original.resources.bindings.filter(b => b.name !== 'ASSETS')) if (!isDeepStrictEqual(binding, checked.resources.bindings.find(b => b.name === binding.name))) throw Error('Binding changed: ' + binding.name);
  const receipt = { stagedAt: new Date().toISOString(), versionId: candidate.id, parentVersion: parent, workerSha256: hash(worker), assetManifestSha256: hash(JSON.stringify(manifest)), apkSha256: apkHash, bindingsPreserved: true, productionUnchanged: isDeepStrictEqual(before, await active()) };
  await writeFile(output + '/version.json', JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
} else {
  const receipt = JSON.parse(await readFile(output + '/version.json', 'utf8'));
  const target = mode === '--rollback' ? receipt.parentVersion : receipt.versionId;
  const expected = mode === '--rollback' ? receipt.versionId : receipt.parentVersion;
  const before = await active();
  if (before.length !== 1 || before[0].version_id !== expected || before[0].percentage !== 100) throw Error('Production changed; refusing traffic change.');
  if (mode === '--activate') {
    const acceptance = JSON.parse(await readFile(output + '/acceptance.json', 'utf8'));
    if (!acceptance.criticalChecksPassed || acceptance.versionId !== target || !acceptance.backupVerified) throw Error('Critical acceptance and verified backup required.');
  }
  await cf(base + '/deployments', 'POST', { strategy: 'percentage', versions: [{ version_id: target, percentage: 100 }] });
  const served = await active();
  if (served.length !== 1 || served[0].version_id !== target || served[0].percentage !== 100) throw Error('Traffic change not verified.');
  if(mode==='--activate'){
    try{
      const response=await fetch(origin+'/owner',{signal:AbortSignal.timeout(60000)});
      if(!response.ok || !response.headers.get('content-type')?.startsWith('text/html'))throw Error('HTML content type invalid.');
      const html=await response.text(),expected=await readFile('dist-worker/index.html','utf8');
      for(const match of expected.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)){
        const path=match[1];if(!html.includes(path))throw Error('HTML release mismatch.');
        const result=await fetch(origin+path,{signal:AbortSignal.timeout(60000)});
        if(!result.ok || !result.headers.get('content-type')?.startsWith(assetMime(path)))throw Error('Asset content type invalid: '+path);
        if(hash(Buffer.from(await result.arrayBuffer()))!==hash(await readFile('dist-worker'+path)))throw Error('Asset bytes mismatch: '+path);
      }
    }catch(error){
      const current=await active();
      if(current.length!==1 || current[0].version_id!==target || current[0].percentage!==100)throw Error('Activation check failed and traffic changed; inspect before rollback.');
      await cf(base+'/deployments','POST',{strategy:'percentage',versions:[{version_id:receipt.parentVersion,percentage:100}]});
      const restored=await active();if(restored.length!==1 || restored[0].version_id!==receipt.parentVersion || restored[0].percentage!==100)throw Error('Activation failed and rollback unconfirmed.');
      await writeFile(output+'/rollback.json',JSON.stringify({checkedAt:new Date().toISOString(),versionId:receipt.parentVersion,traffic:100,reason:String(error)},null,2));
      throw Error('Activation validation failed; rollback verified: '+String(error));
    }
  }
  await writeFile(output + (mode === '--rollback' ? '/rollback.json' : '/deployment.json'), JSON.stringify({ checkedAt: new Date().toISOString(), versionId: target, traffic: 100 }, null, 2));
  console.log(JSON.stringify({versionId:target,traffic:100}));
}
