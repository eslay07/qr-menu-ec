import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
const candidateId=process.argv[2]||'fcea08f9-90ed-498c-b79f-6538ff8d6444';
if(!/^[a-f0-9-]{36}$/.test(candidateId))throw Error('Invalid candidate UUID');
const root=`https://${candidateId.slice(0,8)}-qr-menu-ec.consola.workers.dev`;
const id='998d4980-a169-469f-b009-634a373ca7ad';
const prefix=`/r/${id}`;
const checks=[];
const credential=JSON.parse(execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','auth','token','--json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,WRANGLER_WRITE_LOGS:'false',WRANGLER_SEND_METRICS:'false'}}));
async function cf(path) {
 const r=await fetch('https://api.cloudflare.com/client/v4/accounts/088309af758852fcbfc714c622dff11d/workers/scripts/qr-menu-ec'+path,{headers:{Authorization:`Bearer ${credential.token}`},signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error(`Cloudflare read HTTP ${r.status}`);return (await r.json()).result;
}
const version=await cf(`/versions/${candidateId}`);
const bindings=version.resources.bindings;
for(const [name, expected] of [['DATA_PROVIDER','firestore'],['FIRESTORE_PROJECT_ID','qr-menu-6981a'],['FIRESTORE_REMOTE_ENABLED','true'],['FCM_ENABLED','false']]) checks.push({check:name,passed:bindings.some(b=>b.name===name&&b.text===expected)});
checks.push({check:'FIRESTORE_SERVICE_ACCOUNT present',passed:bindings.some(b=>b.name==='FIRESTORE_SERVICE_ACCOUNT'&&b.type==='secret_text')});
const active=(await cf('/deployments')).deployments[0].versions;
checks.push({check:'D1 production 100%, candidate 0%',passed:active.length===1&&active[0].version_id==='62bff004-11c0-4fa7-9047-b5a26a9cc0f1'&&active[0].percentage===100});
async function probe(path,status) {
 const r=await fetch(root+path,{redirect:'manual',signal:AbortSignal.timeout(20000)});
 checks.push({check:path,status:r.status,passed:r.status===status});return r;
}
const creator=await (await probe('/api/creator/session',200)).json();
checks.push({check:'Creator configured and TOTP preserved',passed:creator.configured&&creator.mfaConfigured&&!creator.authenticated});
checks.push({check:'Firebase Auth enabled',actual:creator.authProvider,passed:creator.authProvider==='firebase'});
const menu=await (await probe(prefix+'/api/v1/menu',200)).json();
checks.push({check:'Correct restaurant published menu',passed:menu.restaurantId===id&&!!menu.catalog});
checks.push({check:'Public menu excludes WiFi credentials',passed:!JSON.stringify(menu).includes('qa-wifi-2026')&&!JSON.stringify(menu).includes('wifiCiphertext')});
const images=[...new Set((menu.catalog?.dishes||[]).map(d=>d.image).filter(p=>typeof p==='string'&&p.startsWith('/media/')))];
for(const image of images) {
 const r=await probe(prefix+image,200);
 checks.push({check:'Image MIME',passed:/^image\/(jpeg|png|webp)/.test(r.headers.get('content-type')||'')}); await r.arrayBuffer();
}
for(const path of ['settings/notifications','settings/wifi','qr/print-wifi','state']) await (await probe(prefix+'/api/v1/'+path,401)).arrayBuffer();
const alias=await probe(prefix+'/menu',302);
checks.push({check:'UUID resolves to canonical HTTPS hostname',passed:alias.headers.get('location')==='https://la-sazon-marinera.consola.workers.dev/menu'});await alias.arrayBuffer();
// Do not follow the alias: it reaches the live D1 worker, not this candidate.
const result={checkedAt:new Date().toISOString(),candidateId,checks,passed:checks.every(c=>c.passed),explicitWrites:0,notes:['GET /api/creator/session can append a Firestore audit event; preserve it during reconciliation.','Authenticated checks and physical APK acceptance are not covered by this script.','Alias destination is production D1 and was not followed.']};
await writeFile('work/migration-preparation/candidate-readonly-smoke.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
if(!result.passed)process.exitCode=1;
