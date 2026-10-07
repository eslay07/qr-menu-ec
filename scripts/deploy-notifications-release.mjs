import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { cf } from './d1-transition-operator.mjs';
if (!process.argv.includes('--activate-notifications')) throw Error('Explicit notification release activation required.');
const base = '/workers/scripts/qr-menu-ec';
const receipt = JSON.parse(await readFile('work/notifications-release/version.json','utf8'));
const qa = JSON.parse(await readFile('outputs/notifications-qa/result.json','utf8'));
const expected = receipt.parentVersion;
if (!['29930545-7db3-4c1b-85f7-525ace3ecb15','f3c32f59-0570-4812-97f3-c541bd8053dc','b96d380c-51d4-44a1-9362-3028642d0d86'].includes(expected) || !qa.passed || !qa.exactDetail || !qa.readPersisted || !qa.missingEventHandled) throw Error('Acceptance evidence missing.');
const hash = value => createHash('sha256').update(value).digest('hex');
if (hash(await readFile('outputs/QR-Menu-EC.apk')) !== receipt.apkSha256 || hash(await readFile('work/notifications-release/worker.js')) !== receipt.workerSha256) throw Error('Release files changed since staging.');
const before = (await cf(base + '/deployments')).deployments[0].versions;
if (before.length !== 1 || before[0].version_id !== expected || before[0].percentage !== 100) throw Error('Production baseline changed.');
const original = await cf(base + '/versions/' + expected), candidate = await cf(base + '/versions/' + receipt.versionId);
for (const binding of original.resources.bindings.filter(b => b.name !== 'ASSETS')) {
  if (!isDeepStrictEqual(binding,candidate.resources.bindings.find(b => b.name === binding.name))) throw Error('Binding changed: ' + binding.name);
}
const origin = 'https://qr-menu-ec.consola.workers.dev';
async function traffic(id) { await cf(base + '/deployments','POST',{strategy:'percentage',versions:[{version_id:id,percentage:100}]}); }
const checks = [];
async function publishedApk() {
  // The deployment API acknowledgement precedes global asset propagation.
  // A previous signed APK is safe to serve temporarily; never accept its hash
  // as evidence for this release. Bound the wait and revert if it persists.
  for (let attempt=0; attempt<8; attempt++) {
    const response = await fetch(origin+'/downloads/qr-menu-ec.apk',{cache:'no-store',signal:AbortSignal.timeout(20000)});
    if (response.ok && hash(Buffer.from(await response.arrayBuffer())) === receipt.apkSha256) {
      const sums=await fetch(origin+'/downloads/SHA256SUMS.txt',{cache:'no-store',signal:AbortSignal.timeout(10000)});
      if (sums.ok && (await sums.text()).includes(receipt.apkSha256)) return;
    }
    if (attempt<7) { console.log('Waiting for verified release assets to propagate.'); await new Promise(resolve=>setTimeout(resolve,7000)); }
  }
  throw Error('Published APK/checksum mismatch after bounded propagation wait.');
}
try {
  await traffic(receipt.versionId);
  const active = (await cf(base + '/deployments')).deployments[0].versions;
  if (active.length !== 1 || active[0].version_id !== receipt.versionId || active[0].percentage !== 100) throw Error('Activation not confirmed.');
  for (const path of ['/owner','/creator','/demo','/r/998d4980-a169-469f-b009-634a373ca7ad/?notification=missing&restaurant=998d4980-a169-469f-b009-634a373ca7ad']) {
    const response = await fetch(origin+path,{signal:AbortSignal.timeout(20000)});
    if (response.status !== 200) throw Error('Shell check failed: '+path);
    checks.push({path,status:response.status});
  }
  const session = await (await fetch(origin+'/api/creator/session',{signal:AbortSignal.timeout(20000)})).json();
  if (session.authProvider !== 'firebase') throw Error('Firebase Auth no longer configured.');
  for (const restaurant of ['998d4980-a169-469f-b009-634a373ca7ad','550cd3d2-eead-4f4a-8505-df582abc001b']) {
    const path = `/r/${restaurant}/api/v1/notifications/missing`;
    const response = await fetch(origin+path,{signal:AbortSignal.timeout(20000)});
    if (response.status !== 401) throw Error('Private notification detail exposed.');
    checks.push({path,status:response.status});
  }
  await publishedApk();
  const result = {checkedAt:new Date().toISOString(),versionId:receipt.versionId,trafficPercent:100,passed:true,bindingsUnchanged:true,firebaseAuth:true,apkSha256:receipt.apkSha256,checks,physicalTapVerified:false};
  await writeFile('work/notifications-release/deployment.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
} catch (error) {
  await traffic(expected);
  const active = (await cf(base + '/deployments')).deployments[0].versions;
  if (active.length !== 1 || active[0].version_id !== expected || active[0].percentage !== 100) throw Error('Rollback requires immediate operator review.');
  throw Error('Reverted notification release: '+error.message);
}
