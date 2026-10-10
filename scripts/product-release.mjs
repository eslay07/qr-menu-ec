import { execFileSync } from 'node:child_process';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { cf } from './d1-transition-operator.mjs';
import { assetDescriptor, assetPart, assetMime, waitForReleaseHtml } from './release-assets.mjs';
import { checkedAndroidRelease } from './android-release.mjs';
import { persistThenReadCandidate, readCreatedVersion, requireVerifiedCandidateIdentity } from './candidate-version.mjs';
import { releaseCompatibilityFlags } from './release-runtime.mjs';

const output = 'work/product-release';
const base = '/workers/scripts/qr-menu-ec';
const hash = value => createHash('sha256').update(value).digest('hex');
const mode = process.argv[2];
const origin = 'https://qr-menu-ec.consola.workers.dev';
if (!['--stage', '--recover-stage', '--activate', '--rollback'].includes(mode)) throw Error('Select stage, recover-stage, activate or rollback.');
await mkdir(output, { recursive: true });
async function active() { return (await cf(base + '/deployments')).deployments[0].versions; }
async function completeStage(pending, original, checked, before) {
  if (checked.id !== pending.versionId) throw Error('Candidate verification identity mismatch.');
  for (const binding of original.resources.bindings.filter(b => b.name !== 'ASSETS')) if (!isDeepStrictEqual(binding, checked.resources.bindings.find(b => b.name === binding.name))) throw Error('Binding changed: ' + binding.name);
  const oldRuntime = original.resources.script_runtime;
  const newRuntime = checked.resources.script_runtime;
  const expectedFlags = releaseCompatibilityFlags(oldRuntime.compatibility_flags, pending.publicFetchEnabled ? 'true' : undefined);
  if (oldRuntime.compatibility_date !== newRuntime.compatibility_date || !isDeepStrictEqual([...expectedFlags].sort((a,b)=>a.localeCompare(b)), [...newRuntime.compatibility_flags].sort((a,b)=>a.localeCompare(b)))) throw Error('Runtime compatibility changed unexpectedly.');
  requireVerifiedCandidateIdentity(pending.versionId, checked.id, before, await active());
  const receipt = { ...pending, bindingsPreserved: true, productionUnchanged: true };
  await writeFile(output + '/version.json', JSON.stringify(receipt, null, 2));
  await writeFile(output + '/pending-version.json', JSON.stringify({ ...pending, verificationCompleted: true }, null, 2));
  console.log(JSON.stringify(receipt));
}
if (mode === '--stage') {
  let unresolved;
  try { unresolved = JSON.parse(await readFile(output + '/pending-version.json', 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (unresolved && !unresolved.verificationCompleted) throw Error('Unverified candidate exists; use --recover-stage without creating another version.');
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
    if (!process.env.QR_MENU_RELEASE_APK_METADATA) throw Error('New APK requires update metadata.');
    const release = checkedAndroidRelease(JSON.parse(await readFile(resolve(process.env.QR_MENU_RELEASE_APK_METADATA), 'utf8')), apk);
    assets.set('/downloads/qr-menu-ec.apk', apk);
    assets.set('/downloads/SHA256SUMS.txt', Buffer.from(`${hash(apk)}  qr-menu-ec.apk\n`));
    assets.set('/downloads/android-release.json', Buffer.from(JSON.stringify(release)));
  } else {
    const response = await fetch(origin + '/downloads/android-release.json', { signal: AbortSignal.timeout(15000) });
    if (response.ok && response.headers.get('content-type')?.startsWith('application/json')) {
      const release = checkedAndroidRelease(await response.json(), assets.get('/downloads/qr-menu-ec.apk'));
      assets.set('/downloads/android-release.json', Buffer.from(JSON.stringify(release)));
    }
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
    compatibility_date: runtime.compatibility_date, compatibility_flags: releaseCompatibilityFlags(runtime.compatibility_flags, process.env.QR_MENU_ENABLE_PUBLIC_FETCH),
    assets: { jwt, config: { run_worker_first: true, html_handling: runtime.assets?.html_handling, not_found_handling: runtime.assets?.not_found_handling } },
    annotations: { 'workers/message': 'Product readiness; preserved production bindings; staged with zero traffic' },
  });
  const pending = { stagedAt: new Date().toISOString(), versionId: candidate.id, parentVersion: parent, workerSha256: hash(worker), assetManifestSha256: hash(JSON.stringify(manifest)), apkSha256: apkHash, publicFetchEnabled: process.env.QR_MENU_ENABLE_PUBLIC_FETCH === 'true' };
  const checked = await persistThenReadCandidate(pending,
    value => writeFile(output + '/pending-version.json', JSON.stringify(value, null, 2)),
    () => cf(base + '/versions/' + candidate.id, 'GET', undefined, false));
  await completeStage(pending, original, checked, before);
} else if (mode === '--recover-stage') {
  const pending = JSON.parse(await readFile(output + '/pending-version.json', 'utf8'));
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  if (!uuid.test(pending.versionId) || !uuid.test(pending.parentVersion)) throw Error('Invalid pending version identity.');
  const before = await active();
  if (before.length !== 1 || before[0].percentage !== 100 || before[0].version_id !== pending.parentVersion) throw Error('Production changed; refusing stage recovery.');
  const original = await cf(base + '/versions/' + pending.parentVersion);
  const checked = await readCreatedVersion(() => cf(base + '/versions/' + pending.versionId, 'GET', undefined, false));
  await completeStage(pending, original, checked, before);
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
      const expected=await readFile('dist-worker/index.html','utf8');
      const paths=Array.from(expected.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g), match => match[1]);
      const html=await waitForReleaseHtml(() => fetch(origin+'/owner',{signal:AbortSignal.timeout(60000)}),paths);
      for(const match of expected.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)){
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
