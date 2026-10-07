import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {FirestoreRest} from '../lib/firestore-rest';
import {D1DocumentStore} from '../lib/d1-documents';
import {documentManifest,reconcileDocuments} from '../lib/document-transfer';
import {planDocumentMerge} from '../lib/document-merge';
import {validateDocumentIntegrity} from '../lib/document-integrity';
import {privateDocumentSource} from './private-document-source';
import {awaitMaintenance} from './maintenance-convergence.mjs';
import {cf,remoteD1,unchangedProduction} from './d1-transition-operator.mjs';

// This controller is separate from the historical D1 -> Firestore cut. It
// preserves both branches and never rolls traffic back over newer D1 writes.
const base='/workers/scripts/qr-menu-ec',original='724862e7-0c75-4bdd-b01a-4067891f78fe';
const candidate=JSON.parse(await readFile('work/d1-production-candidate/version.json','utf8'));
const maintenance=JSON.parse(await readFile('work/d1-transition/maintenance.json','utf8')).maintenanceVersion;
const db=new D1DocumentStore(remoteD1('0c8dab0c-5e79-4272-a28c-90b00a93e676') as unknown as D1Database);
const revisions=new Set(['platformConfig/creator','restaurants/998d4980-a169-469f-b009-634a373ca7ad']);
await unchangedProduction();
const smoke=JSON.parse(await readFile('work/d1-production-candidate/smoke.json','utf8'));
const print=JSON.parse(await readFile('work/d1-production-candidate/desktop-print-qa.json','utf8'));
const wifi=JSON.parse(await readFile('work/d1-production-candidate/wifi-restored.json','utf8'));
const rehearsal=JSON.parse(await readFile('work/d1-transition/cut-rehearsal.json','utf8'));
if(!rehearsal.verified||!rehearsal.interruptionAndResume||!rehearsal.preActivationRollbackExact||!rehearsal.postActivationWritePreserved||rehearsal.remoteWrites!==0)throw Error('Cut rehearsal missing');
if(smoke.versionId!==candidate.versionId||!smoke.passed||!wifi.originalWifiRestored||!print.reports.every((r:{pages:number;overflow:boolean;wifiFontPx:number})=>r.pages===1&&!r.overflow&&r.wifiFontPx>=26.6))throw Error('Acceptance evidence missing');
const before=await privateDocumentSource('work/d1-transition/initial-source-receipt.json');
const current=await privateDocumentSource('work/d1-transition/source-receipt.json');
const proposed=planDocumentMerge(before,current,await db.inventoryWire(100000),{renewRevisionPaths:revisions,conservativeRateLimits:true});
if(proposed.conflicts.length)throw Error('Unresolved merge conflicts');
const integrity=validateDocumentIntegrity(proposed.documents);
async function verifyMaintenance(){
 await awaitMaintenance(async()=>Promise.all(['qr-menu-ec.consola.workers.dev','la-sazon-marinera.consola.workers.dev'].flatMap(host=>['/menu','/owner','/api/creator/session','/api/owner/renew','/r/998d4980-a169-469f-b009-634a373ca7ad/api/v1/menu'].map(async path=>{
  const response=await fetch(`https://${host}${path}`,{redirect:'manual',signal:AbortSignal.timeout(15000)});await response.arrayBuffer();return {host,path,status:response.status,marker:response.headers.get('X-QRMenu-Maintenance'),build:response.headers.get('X-QRMenu-Maintenance-Build')};
 }))));
}
if(!process.argv.includes('--execute-authorized-window')){
 console.log(JSON.stringify({readOnly:true,candidate:candidate.versionId,maintenance,integrity,readyForRehearsal:true}));
}else{
 const physical=JSON.parse(await readFile('work/d1-production-candidate/honor-session-confirmation.json','utf8'));
 if(physical.device!=='Honor LNA-LX3'||physical.panelStableWithoutLogin!==true||physical.confirmedBy!=='user'||!Number.isFinite(Date.parse(physical.confirmedAt)))throw Error('Final physical session confirmation missing');
 const start=Date.now(),deadline=start+45*60*1000,dir=`work/d1-transition/cut-${crypto.randomUUID()}`;
 await mkdir(dir,{recursive:true});
 const subdomain=await cf(base+'/subdomain'),schedules=await cf(base+'/schedules');
 let frozen=false,activated=false,rulesFrozen=false,sourceTouched=false,recovering=false,stage='preflight';
 let sourceBaseline:Awaited<ReturnType<typeof documentManifest>>|undefined;
 const require=createRequire(import.meta.url),project='qr-menu-6981a';
 const auth=require('firebase-tools/lib/auth');
 await require('firebase-tools/lib/requireAuth').requireAuth({project,nonInteractive:true,...auth.getProjectDefaultAccount(process.cwd())});
 const source=new FirestoreRest(project,'',()=>require('firebase-tools/lib/apiv2').getAccessToken());
 const active=async()=>((await cf(base+'/deployments')).deployments[0].versions);
 async function traffic(id:string){await cf(base+'/deployments','POST',{strategy:'percentage',versions:[{version_id:id,percentage:100}]});}
 async function run(args:string[],label:string){
  stage=label;if(!recovering&&Date.now()>deadline)throw Error('Window deadline reached');
  console.log(JSON.stringify({stage,at:new Date().toISOString()}));
  await new Promise<void>((resolve,reject)=>{
   const child=spawn(process.execPath,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,WRANGLER_SEND_METRICS:'false',WRANGLER_WRITE_LOGS:'false'}});
   let bytes=0;for(const stream of [child.stdout,child.stderr])stream.on('data',buffer=>{bytes+=buffer.length;if(bytes>10_000_000)child.kill();});
   const timer=setTimeout(()=>child.kill(),recovering?15*60*1000:Math.max(1000,deadline-Date.now()));
   child.on('error',error=>{clearTimeout(timer);reject(error);});child.on('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error(`${label} failed (${code})`));});
  });
 }
 async function guard(){
  if(!recovering&&Date.now()>deadline)throw Error('Window deadline reached');
  const versions=await active();
  if(versions.length!==1||versions[0].version_id!==maintenance||versions[0].percentage!==100)throw Error('Maintenance lost');
  if((await cf(base+'/subdomain')).previews_enabled!==false)throw Error('Preview writes not frozen');
  if((await cf(base+'/schedules')).schedules.length)throw Error('Scheduled writes not frozen');
 }
 async function restoreRules(){
  // Only Firestore rules: never Storage or FCM configuration.
  await run(['node_modules/firebase-tools/lib/bin/firebase.js','deploy','--only','firestore:rules','--project',project,'--config','firebase.preparation.json','--non-interactive'],'restore-rules');rulesFrozen=false;
 }
 async function restoreConfiguration(){
  await cf(base+'/schedules','PUT',schedules.schedules.map((row:{cron:string})=>({cron:row.cron})));
  await cf(base+'/subdomain','POST',{enabled:subdomain.enabled,previews_enabled:subdomain.previews_enabled});
 }
 try{
  stage='maintenance';frozen=true;await traffic(maintenance);
  await cf(base+'/subdomain','POST',{enabled:true,previews_enabled:false});await cf(base+'/schedules','PUT',[]);
  await verifyMaintenance();
  rulesFrozen=true;
  await run(['node_modules/firebase-tools/lib/bin/firebase.js','deploy','--only','firestore:rules','--project',project,'--config','firebase.migration-freeze.json','--non-interactive'],'freeze-client-rules');
  const frozenRules=await fetch(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/publicMenus/998d4980-a169-469f-b009-634a373ca7ad`);
  if(frozenRules.status!==403)throw Error('Client write/read freeze not effective');await frozenRules.arrayBuffer();
  await guard();
  await run(['scripts/production-backup.mjs','--backup-d1'],'backup-legacy-photos');
  await run(['scripts/production-backup.mjs','--backup-d1','--operational-documents'],'backup-operational');
  await run(['--import','tsx','scripts/prepare-d1-source.mjs'],'capture-frozen-source');
  await guard();
  const finalSource=await privateDocumentSource('work/d1-transition/source-receipt.json'),target=await db.inventoryWire(100000);
  sourceBaseline=await documentManifest(finalSource);
  const merged=planDocumentMerge(before,finalSource,target,{renewRevisionPaths:revisions,conservativeRateLimits:true});
  if(merged.conflicts.length)throw Error('Final reconciliation conflicts');
  const verified=validateDocumentIntegrity(merged.documents),desired=await documentManifest(merged.documents);
  const targetBaseline=await documentManifest(target);
  stage='reconcile-d1';const result=await reconcileDocuments(db,targetBaseline,desired,{authorizeWrites:guard});
  // Mirror only this frozen final state, not runtime dual writes. It preserves
  // accepted QA identity changes and provides an identical rollback baseline.
  stage='synchronize-rollback-baseline';sourceTouched=true;
  await reconcileDocuments(source,sourceBaseline,desired,{authorizeWrites:guard});
  await writeFile(dir+'/verified.json',JSON.stringify({at:new Date().toISOString(),freezeVerified:true,integrity:verified,result,candidate:candidate.versionId,mirrorVerified:true},null,2));
  // Keep the archived Firestore copy closed to browser SDK writes while D1
  // is operational. Normal rules are restored only during a verified rollback
  // or a future explicit migration back, not before this cut.
  await guard();
  stage='activate';activated=true;await traffic(candidate.versionId);
  await cf(base+'/schedules','PUT',[{cron:'* * * * *'}]);
  // Leave old preview URLs disabled after launch: they must not keep mutating
  // the old provider or act as permanent operational entry points.
  stage='production-smoke';
  let consecutive=0;const smokeDeadline=Date.now()+90_000;
  while(consecutive<3&&Date.now()<smokeDeadline){
   let passed=true;
   for(const host of ['qr-menu-ec.consola.workers.dev','la-sazon-marinera.consola.workers.dev'])for(const path of ['/api/creator/session','/r/998d4980-a169-469f-b009-634a373ca7ad/api/v1/menu']){
    const response=await fetch('https://'+host+path,{redirect:'manual',signal:AbortSignal.timeout(15000)}),body=await response.json().catch(()=>null) as Record<string,unknown>|null;
    passed&&=response.status===200&&(path.endsWith('/menu')?body?.restaurantId==='998d4980-a169-469f-b009-634a373ca7ad'&&!!body.catalog&&!JSON.stringify(body).includes('wifiCiphertext'):body?.authProvider==='firebase'&&body.mfaConfigured===true);
   }
   consecutive=passed?consecutive+1:0;
   if(consecutive<3)await new Promise(resolve=>setTimeout(resolve,3000));
  }
  if(consecutive!==3)throw Error('Production did not converge');
  const apk=await fetch('https://qr-menu-ec.consola.workers.dev/downloads/qr-menu-ec.apk');
  if(apk.status!==200)throw Error('APK unavailable');
  const digest=await crypto.subtle.digest('SHA-256',await apk.arrayBuffer()),apkHash=Array.from(new Uint8Array(digest)).map(value=>value.toString(16).padStart(2,'0')).join('');
  if(apkHash!==candidate.apkSha256)throw Error('Published APK checksum mismatch');
  const deployed=await active();if(deployed.length!==1||deployed[0].version_id!==candidate.versionId||deployed[0].percentage!==100)throw Error('Activation not confirmed');
  await writeFile(dir+'/completed.json',JSON.stringify({completedAt:new Date().toISOString(),candidate:candidate.versionId,provider:'d1-documents',traffic:100,checksum:desired.checksum,documents:desired.documents.length,pushEnabled:true,previewsDisabled:true},null,2));
  console.log(JSON.stringify({completed:true,candidate:candidate.versionId,evidence:dir}));
 }catch(error){
  const failure=error instanceof Error?error.message:'Cut failed',failedStage=stage;recovering=true;
  // Never silently restore a stale provider once the new provider accepted
  // writes. Freeze again and synchronize the current D1 state first.
  try{
   if(activated){await traffic(maintenance);await cf(base+'/schedules','PUT',[]);await verifyMaintenance();const fresh=await db.inventoryWire(100000);validateDocumentIntegrity(fresh);const wanted=await documentManifest(fresh);await reconcileDocuments(source,await documentManifest(await source.inventoryWire(100000)),wanted,{authorizeWrites:guard});}
   else if(sourceTouched&&sourceBaseline){await reconcileDocuments(source,await documentManifest(await source.inventoryWire(100000)),sourceBaseline,{authorizeWrites:guard});}
   if(rulesFrozen)await restoreRules();if(frozen)await traffic(original);await restoreConfiguration();
   await writeFile(dir+'/failed.json',JSON.stringify({at:new Date().toISOString(),stage:failedStage,cause:failure,reverted:true},null,2));
  }catch{
   await writeFile(dir+'/failed.json',JSON.stringify({at:new Date().toISOString(),stage:failedStage,cause:failure,reverted:false,requiresRecovery:true},null,2));
   throw Error('Recovery could not be verified; inspect private cut receipt before changing traffic');
  }
  throw Error(`Reverted: ${failedStage}: ${failure}`);
 }
}
