import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { awaitMaintenance } from './maintenance-convergence.mjs';

const original='62bff004-11c0-4fa7-9047-b5a26a9cc0f1';
const receiptPath=process.argv[3]||'work/migration-preparation/maintenance-version-v2.json';
const dir=process.argv[4]||'work/migration-window-2026-10-04-v3';
if(!/^work\/[a-zA-Z0-9/_.-]+\.json$/.test(receiptPath)||!/^work\/[a-zA-Z0-9/_.-]+$/.test(dir)||receiptPath.includes('..')||dir.includes('..'))throw Error('Invalid window paths');
const staged=JSON.parse(await readFile(receiptPath,'utf8'));
const maintenance=staged.maintenanceVersion;
const account='088309af758852fcbfc714c622dff11d';
const worker='/workers/scripts/qr-menu-ec';
const mode=process.argv[2];
let attempted=false,stage='credentials';
const token=JSON.parse(execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','auth','token','--json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,WRANGLER_WRITE_LOGS:'false',WRANGLER_SEND_METRICS:'false'}})).token;
async function request(path,init={}) {
  const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`,{...init,headers:{Authorization:`Bearer ${token}`,...init.headers},signal:AbortSignal.timeout(20000)});
  if(!r.ok){const j=await r.json().catch(()=>({}));throw Error(`HTTP ${r.status}; codes ${(j.errors||[]).map(e=>e.code).join(',')}`);}return r;
}
async function api(path,init) {return (await (await request(path,init)).json()).result;}
async function active(){return (await api(worker+'/deployments')).deployments[0];}
function exactly(d,id){return d.versions.length===1&&d.versions[0].version_id===id&&d.versions[0].percentage===100;}
async function deploy(id){return api(worker+'/deployments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({strategy:'percentage',versions:[{version_id:id,percentage:100}],annotations:{'workers/message':id===maintenance?'Authorized migration maintenance window':'Abort migration: restore original D1 production'}})});}
async function rollback(){
  const current=await active();
  if(!exactly(current,original)&&!exactly(current,maintenance))throw Error('Rollback blocked: another version is active; do not discard live Firestore writes');
  if(!exactly(current,original))await deploy(original);
  const d=await active();if(!exactly(d,original))throw Error('Rollback not confirmed');
  const receipt={checkedAt:new Date().toISOString(),restoredVersion:original,traffic:100};
  await writeFile(`${dir}/rollback.json`,JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
}
try {
  await mkdir(dir,{recursive:true});
  if(mode==='--rollback'){await rollback();process.exit(0);}
  if(mode!=='--activate-maintenance')throw Error('Explicit mode required');
  stage='baseline';const before=await active();if(!exactly(before,original))throw Error('Production baseline differs');
  const originalVersion=await api(worker+`/versions/${original}`);
  const m=await api(worker+`/versions/${maintenance}`);
  if(!isDeepStrictEqual(originalVersion.resources.bindings.find(b=>b.name==='DB'),m.resources.bindings.find(b=>b.name==='DB'))||!m.resources.bindings.some(b=>b.name==='MAINTENANCE_MODE'&&b.text==='true'))throw Error('Maintenance configuration differs');
  if((await api(worker+'/versions')).items[0].id!==maintenance)throw Error('Latest differs; checksum attribution unsafe');
  const content=await (await request(worker+'/content/v2')).formData();
  const bytes=Buffer.from(await content.get('maintenance.js').arrayBuffer());
  if(createHash('sha256').update(bytes).digest('hex')!==staged.sha256)throw Error('Maintenance checksum differs');
  stage='domain-inventory';
  const hostRows=await api('/d1/database/e81ee150-55f7-434f-84de-299b2d001f1c/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sql:'SELECT hostname FROM restaurant_hosts'})});
  const hosts=[...new Set(['qr-menu-ec.consola.workers.dev',...hostRows[0].results.map(r=>r.hostname)])];
  if(hosts.some(h=>!/^[a-z0-9.-]+$/.test(h)))throw Error('Invalid hostname inventory');
  await writeFile(`${dir}/domains.json`,JSON.stringify(hosts,null,2));
  if(!isDeepStrictEqual(before,await active()))throw Error('Concurrent deployment');
  stage='activate';attempted=true;await deploy(maintenance);
  if(!exactly(await active(),maintenance))throw Error('Maintenance traffic not confirmed');
  console.log(JSON.stringify({step:2,maintenance,traffic:100}));
  stage='probe-all-domains';
  const attempts=await awaitMaintenance(async()=>{
    if(!exactly(await active(),maintenance))throw Error('Maintenance deployment changed');
    return Promise.all(hosts.flatMap(host=>['/','/owner','/creator','/api/owner/login','/api/owner/device','/r/998d4980-a169-469f-b009-634a373ca7ad/'].map(async path=>{
      const r=await fetch(`https://${host}${path}?migration_probe=${Date.now()}`,{redirect:'manual',headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(10000)});
      const result={host,path,status:r.status,marker:r.headers.get('X-QRMenu-Maintenance'),build:r.headers.get('X-QRMenu-Maintenance-Build')};await r.arrayBuffer();return result;
    })));
  });
  const receipt={checkedAt:new Date().toISOString(),step:3,attempts,passed:true,maintenanceVersion:maintenance,rollbackVersion:original};
  await writeFile(`${dir}/maintenance-verified.json`,JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt,null,2));
}catch(e){
  console.error(JSON.stringify({stage,error:e.message,activationAttempted:attempted}));
  if(attempted){try{await rollback();}catch{console.error('URGENT: original version restoration not confirmed');}}
  process.exitCode=1;
}
