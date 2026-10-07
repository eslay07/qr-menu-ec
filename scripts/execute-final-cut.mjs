import { spawn, execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

if(process.argv[2]!=='--approved-acceptance-and-cut')throw Error('Explicit approved cut required');
const dir=process.argv[3]||'work/migration-window-2026-10-05-final';
if(!/^work\/migration-window-2026-10-05-[a-z0-9-]+$/.test(dir))throw Error('Invalid isolated window directory');
const maintenanceReceipt='work/migration-preparation/maintenance-final-2026-10-05.json';
const staged=JSON.parse(await readFile(maintenanceReceipt,'utf8'));
const candidate=JSON.parse(await readFile('work/print-candidate-v2/version.json','utf8'));
const desktop=JSON.parse(await readFile('work/print-candidate-v2/desktop-print-qa.json','utf8'));
const wifi=JSON.parse(await readFile('work/print-candidate-v2/wifi-restored.json','utf8'));
if(!desktop.reports.every(r=>r.pages===1&&r.wifiFontPx>=26.6&&!r.overflow)||!wifi.restoredOriginalWifi||!candidate.bindingsUnchanged||!candidate.workerUnchanged)throw Error('Acceptance artifacts incomplete');
const original='62bff004-11c0-4fa7-9047-b5a26a9cc0f1';
const maintenance=staged.maintenanceVersion;
const start=Date.now(),deadline=start+45*60*1000;
await mkdir(dir,{recursive:true});
await writeFile(dir+'/started.json',JSON.stringify({startedAt:new Date(start).toISOString(),deadline:new Date(deadline).toISOString(),candidate:candidate.candidateVersion,maintenance,original},null,2),{flag:'wx'});
function currentToken(){return JSON.parse(execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','auth','token','--json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,WRANGLER_WRITE_LOGS:'false',WRANGLER_SEND_METRICS:'false'}})).token;}
let token=currentToken();
const base='https://api.cloudflare.com/client/v4/accounts/088309af758852fcbfc714c622dff11d/workers/scripts/qr-menu-ec';
async function cf(path,init={}){
 for(let attempt=0;attempt<2;attempt++){
  const r=await fetch(base+path,{...init,headers:{Authorization:`Bearer ${token}`,...init.headers},signal:AbortSignal.timeout(25000)});
  // Other CLI processes can renew OAuth while a long reconciliation is running.
  // A rejected 401 has not executed the request; renew privately and retry once.
  if(r.status===401&&attempt===0){await r.arrayBuffer();token=currentToken();continue;}
  if(!r.ok)throw Error(`Cloudflare HTTP ${r.status}`);return(await r.json()).result;
 }
}
const active=async()=>(await cf('/deployments')).deployments[0].versions;
const exactly=(rows,id)=>rows.length===1&&rows[0].version_id===id&&rows[0].percentage===100;
async function run(args,label,env={}){
 const cleanup=label==='rollback'||label==='restore-rules-after-abort';
 if(!cleanup&&Date.now()>deadline)throw Error('Window deadline reached');
 console.log(JSON.stringify({stage:label,at:new Date().toISOString()}));
 const child=spawn(process.execPath,args,{windowsHide:true,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';
 child.stdout.on('data',b=>{stdout+=b;if(stdout.length>20000000)child.kill()});
 child.stderr.on('data',b=>{stderr+=b;if(stderr.length>20000000)child.kill()});
 const timer=setTimeout(()=>child.kill(),cleanup?5*60*1000:Math.min(deadline-Date.now(),20*60*1000));
 const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve)});clearTimeout(timer);
 await writeFile(`${dir}/${label}.log`,stdout+'\n'+stderr);
 if(code!==0)throw Error(`${label} failed; inspect private log`);
 return stdout;
}
let stage='baseline',frozen=false,rulesFrozen=false,activated=false;
try{
 if(!exactly(await active(),original))throw Error('D1 production baseline changed');
 const flags=(await cf('/versions/'+candidate.candidateVersion)).resources.bindings;
 for(const[name,value]of Object.entries({AUTH_PROVIDER:'firebase',DATA_PROVIDER:'firestore',FIRESTORE_PROJECT_ID:'qr-menu-6981a',FIRESTORE_REMOTE_ENABLED:'true',FCM_ENABLED:'false',MAINTENANCE_MODE:'false'}))if(!flags.some(b=>b.name===name&&b.text===value))throw Error('Candidate flag mismatch');
 for(const name of ['FIREBASE_SERVICE_ACCOUNT','FIRESTORE_SERVICE_ACCOUNT','DATA_ENCRYPTION_KEY'])if(!flags.some(b=>b.name===name&&b.type==='secret_text'))throw Error('Candidate secret missing');
 stage='maintenance';
 await run(['scripts/migration-window-control.mjs','--activate-maintenance',maintenanceReceipt,dir],stage);frozen=true;
 const watchdog=spawn(process.execPath,['scripts/migration-window-watchdog.mjs',maintenanceReceipt,dir],{windowsHide:true,stdio:'ignore',detached:true});watchdog.unref();
 stage='freeze-rules';
 rulesFrozen=true;
 await run(['node_modules/firebase-tools/lib/bin/firebase.js','deploy','--only','firestore:rules','--project','qr-menu-6981a','--config','firebase.migration-freeze.json','--non-interactive'],stage);
 const probe=await fetch('https://firestore.googleapis.com/v1/projects/qr-menu-6981a/databases/(default)/documents/publicMenus/998d4980-a169-469f-b009-634a373ca7ad');
 if(probe.status!==403)throw Error('Client rules freeze not effective');await probe.arrayBuffer();
 stage='final-backup';
 const backupOutput=await run(['scripts/production-backup.mjs','--backup-d1'],stage);
 const backup=JSON.parse(backupOutput.slice(backupOutput.indexOf('{\n  "directory"')));
 if(!backup.restoreVerified||backup.workerVersion!==maintenance||backup.mediaObjects!==16)throw Error('Frozen backup verification failed');
 await writeFile(dir+'/backup.json',JSON.stringify(backup,null,2),{flag:'wx'});
 stage='isolated-rehearsal';
 const clear=await fetch('http://127.0.0.1:18985/emulator/v1/projects/demo-qr-menu-migration/databases/(default)/documents',{method:'DELETE'});
 if(!clear.ok)throw Error('Dedicated emulator reset failed');
 const runId=randomUUID(),emulatorEnv={FIRESTORE_EMULATOR_HOST:'127.0.0.1:18985'};
 await run(['--import','tsx','scripts/encrypted-migration-rehearsal.mjs',backup.directory,runId],stage,emulatorEnv);
 const rehearsal=JSON.parse(await readFile(`${backup.directory}/migration-${runId}.json`,'utf8'));
 if(rehearsal.status!=='verified'||!rehearsal.resumeVerified||rehearsal.orders!==7||rehearsal.restaurants!==2)throw Error('Final rehearsal differs');
 stage='prepare-manifest';
 const prepared=JSON.parse((await run(['--import','tsx','scripts/firestore-remote-migrate.ts','--prepare',dir+'/manifest.dpapi',rehearsal.sourceChecksum,runId],stage,emulatorEnv)).trim());
 await writeFile(dir+'/manifest-receipt.json',JSON.stringify(prepared,null,2),{flag:'wx'});
 stage='reconcile';
 await run(['--import','tsx','scripts/final-reconciliation.ts','--apply',dir+'/manifest.dpapi',prepared.checksum,dir+'/reconciliation.json',maintenance],stage,{REMOTE_MIGRATION_AUTHORIZATION:'APPROVED_FROZEN_WINDOW'});
 const reconciled=JSON.parse(await readFile(dir+'/reconciliation.json','utf8'));
 if(reconciled.conflicts.length||!reconciled.result?.verified)throw Error('Final reconciliation not verified');
 if(!exactly(await active(),maintenance))throw Error('Maintenance changed before cut');
 stage='restore-rules';
 await run(['node_modules/firebase-tools/lib/bin/firebase.js','deploy','--only','firestore:rules','--project','qr-menu-6981a','--config','firebase.preparation.json','--non-interactive'],stage);rulesFrozen=false;
 const publicProbe=await fetch('https://firestore.googleapis.com/v1/projects/qr-menu-6981a/databases/(default)/documents/publicMenus/998d4980-a169-469f-b009-634a373ca7ad');
 if(publicProbe.status!==200)throw Error('Normal public rules not restored');await publicProbe.arrayBuffer();
 stage='activate-candidate';
 if(Date.now()>deadline)throw Error('Window deadline reached before activation');
 token=currentToken();
 if(!exactly(await active(),maintenance))throw Error('Maintenance changed before deployment');
 await cf('/deployments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({strategy:'percentage',versions:[{version_id:candidate.candidateVersion,percentage:100}],annotations:{'workers/message':'Accepted Honor/Desktop print fix; reconciled Firestore final cut'}})});
 if(!exactly(await active(),candidate.candidateVersion))throw Error('Candidate traffic not confirmed');activated=true;
 await writeFile(dir+'/watchdog-stop','activated');
 stage='production-smoke';
 // An acknowledged control-plane deployment is not proof of edge convergence.
 // Require three complete rounds and preserve private draft images as 401.
 await run(['scripts/confirm-final-cut.mjs',dir],stage);
 await run(['scripts/post-cut-integrity.mjs',dir],'post-cut-integrity');
 const result=JSON.parse(await readFile(dir+'/completed.json','utf8'));
 console.log(JSON.stringify({...result,attempts:undefined},null,2));
}catch(error){
 console.error(JSON.stringify({stage,activated,error:error.message}));
 if(!activated){
  if(frozen)await run(['scripts/migration-window-control.mjs','--rollback',maintenanceReceipt,dir],'rollback').catch(()=>{});
  if(rulesFrozen)await run(['node_modules/firebase-tools/lib/bin/firebase.js','deploy','--only','firestore:rules','--project','qr-menu-6981a','--config','firebase.preparation.json','--non-interactive'],'restore-rules-after-abort').catch(()=>{});
  await writeFile(dir+'/watchdog-stop','aborted');
 }
 const finalActive=await active().catch(()=>null);
 await writeFile(dir+'/failed.json',JSON.stringify({at:new Date().toISOString(),stage,activated,active:finalActive,cause:error.message},null,2));process.exitCode=1;
}
