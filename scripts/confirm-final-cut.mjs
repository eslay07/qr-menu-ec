import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const dir=process.argv[2];
if(!/^work\/migration-window-2026-10-05-[a-z0-9-]+$/.test(dir||''))throw Error('Window directory required');
const start=JSON.parse(await readFile(dir+'/started.json','utf8'));
const reconciled=JSON.parse(await readFile(dir+'/reconciliation.json','utf8'));
const backup=JSON.parse(await readFile(dir+'/backup.json','utf8'));
const credential=JSON.parse(await readFile('work/migration-preparation/temporary-credential.json','utf8'));
if(!reconciled.result?.verified||reconciled.conflicts.length||reconciled.result.deletedDocuments!==0||!backup.restoreVerified||credential.status!=='revoked')throw Error('Migration evidence incomplete');
const token=JSON.parse(execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','auth','token','--json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,WRANGLER_WRITE_LOGS:'false',WRANGLER_SEND_METRICS:'false'}})).token;
const base='https://api.cloudflare.com/client/v4/accounts/088309af758852fcbfc714c622dff11d/workers/scripts/qr-menu-ec';
async function cf(path){const r=await fetch(base+path,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Cloudflare verification unavailable');return(await r.json()).result;}
async function confirmTraffic(){const rows=(await cf('/deployments')).deployments[0].versions;if(rows.length!==1||rows[0].version_id!==start.candidate||rows[0].percentage!==100)throw Error('Candidate not exclusively active');}
await confirmTraffic();
const bindings=(await cf('/versions/'+start.candidate)).resources.bindings;
for(const[name,value]of Object.entries({AUTH_PROVIDER:'firebase',DATA_PROVIDER:'firestore',FIRESTORE_PROJECT_ID:'qr-menu-6981a',FIRESTORE_REMOTE_ENABLED:'true',FCM_ENABLED:'false',MAINTENANCE_MODE:'false'}))if(!bindings.some(b=>b.name===name&&b.text===value))throw Error('Active flags mismatch');
const publicRule=await fetch('https://firestore.googleapis.com/v1/projects/qr-menu-6981a/databases/(default)/documents/publicMenus/998d4980-a169-469f-b009-634a373ca7ad');
if(publicRule.status!==200)throw Error('Normal Firestore rules not restored');await publicRule.arrayBuffer();
const privateRule=await fetch('https://firestore.googleapis.com/v1/projects/qr-menu-6981a/databases/(default)/documents/restaurants/998d4980-a169-469f-b009-634a373ca7ad/settings/general');
if(privateRule.status!==403)throw Error('Private Firestore rules not enforced');await privateRule.arrayBuffer();
const attempts=[];let consecutive=0;
const deadline=Date.now()+90000;
while(Date.now()<deadline&&consecutive<3){
 const checks=[];
 for(const host of ['qr-menu-ec.consola.workers.dev','la-sazon-marinera.consola.workers.dev']){
  for(const path of ['/r/998d4980-a169-469f-b009-634a373ca7ad/api/v1/menu','/api/creator/session']){
   const r=await fetch('https://'+host+path,{redirect:'manual',signal:AbortSignal.timeout(15000)}),j=await r.json().catch(()=>({}));
   const passed=r.status===200&&(path.endsWith('/menu')?j.restaurantId==='998d4980-a169-469f-b009-634a373ca7ad'&&!!j.catalog&&!JSON.stringify(j).includes('wifiCiphertext'):j.authProvider==='firebase'&&j.mfaConfigured===true);
   checks.push({host,path,status:r.status,passed});
  }
 }
 const passed=checks.every(c=>c.passed);attempts.push({at:new Date().toISOString(),passed,checks});consecutive=passed?consecutive+1:0;
 if(consecutive<3)await new Promise(r=>setTimeout(r,3000));
}
if(consecutive!==3)throw Error('Production edge convergence failed');
await confirmTraffic();
const result={completedAt:new Date().toISOString(),productionActivated:true,version:start.candidate,trafficPercent:100,firestoreVerified:true,sourceDocuments:reconciled.sourceDocuments,reconciledDocuments:reconciled.remoteWrites,deletedDocuments:0,backupDirectory:backup.directory,sqlSha256:backup.sqlSha256,archiveSha256:backup.archiveSha256,temporaryCredentialRevoked:true,fcmEnabled:false,rulesRestoredAndVerified:true,edgeConvergenceRounds:3,attempts,initialSmoke:'Immediate post-deployment probe was transient; subsequent convergence verified before completion'};
await writeFile(dir+'/completed.json',JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify({...result,attempts:undefined},null,2));
