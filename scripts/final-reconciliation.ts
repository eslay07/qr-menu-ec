import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { Buffer } from 'node:buffer';
import { FirestoreRest } from '../lib/firestore-rest';
import { validateManifest, canonicalWire, type MigrationManifest } from '../lib/firestore-remote-migration';
import { reconciliationPlan, applyReconciliation, alignUnchangedCatalogs } from '../lib/firestore-reconciliation';
import { withMigrationCredential, migrationIam, credentialAudit } from './migration-credential.mjs';
const require=createRequire(import.meta.url);
const [mode,currentFile,currentChecksum,output,maintenanceVersion]=process.argv.slice(2);
if(!['--dry-run','--apply','--inspect-source'].includes(mode)||!output)throw Error('Mode, encrypted manifest, checksum and report required');
async function manifest(file:string,checksum:string){
 const encrypted=Buffer.from(await readFile(file));
 const plain=Buffer.from(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','Add-Type -AssemblyName System.Security; $reconcileBytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); [Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($reconcileBytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))'],{input:encrypted.toString('base64'),encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:100000000}),'base64');
 let value:MigrationManifest;try{value=JSON.parse(plain.toString());}finally{plain.fill(0)}
 await validateManifest(value,checksum);return value;
}
const baseline=await manifest('work/migration-window-2026-10-04-v3/manifest.dpapi','8u8z9K3hWDZ4zpLN0mluLa42EwukenNyzM1NyPn+e4w=');
const current=await manifest(currentFile,currentChecksum);
if(mode==='--inspect-source'){
 const aligned=alignUnchangedCatalogs(baseline,current);
 const old=new Map(baseline.documents.map(d=>[d.path,d.fields]));
 const now=new Map(aligned.documents.map(d=>[d.path,d.fields]));
 console.log(JSON.stringify({added:[...now.keys()].filter(p=>!old.has(p)),removed:[...old.keys()].filter(p=>!now.has(p)),changed:[...now.keys()].filter(p=>old.has(p)&&canonicalWire(old.get(p))!==canonicalWire(now.get(p)))},null,2));
 process.exit(0);
}
const auth=require('firebase-tools/lib/auth');
await require('firebase-tools/lib/requireAuth').requireAuth({project:current.project,nonInteractive:true,...auth.getProjectDefaultAccount(process.cwd())});
const {getAccessToken}=require('firebase-tools/lib/apiv2');
let db=new FirestoreRest(current.project,'',getAccessToken);
// Original immutable importer journals are preserved, not replayed or scanned.
const excludedSubtrees=[`migrationRuns/${baseline.runId}`];
const remote=await db.inventoryWire(100000,excludedSubtrees);
const plan=reconciliationPlan(baseline,current,remote);
const find=(m:MigrationManifest,path:string)=>m.documents.find(d=>d.path===path)?.fields;
const report={checkedAt:new Date().toISOString(),mode,sourceDocuments:current.documents.length,remoteDocuments:remote.length,requiredWrites:plan.writes.length,retainedRemoteChanges:plan.retainedRemoteChanges,remoteOnly:plan.remoteOnly,retainedSourceRemovals:plan.retainedSourceRemovals,conflicts:plan.conflicts.map(path=>({path,sourceChangedFields:Object.keys({...find(baseline,path),...find(current,path)}).filter(k=>canonicalWire(find(baseline,path)?.[k])!==canonicalWire(find(current,path)?.[k]))})),remoteWrites:0};
if(mode==='--apply'){
 if(plan.conflicts.length||process.env.REMOTE_MIGRATION_AUTHORIZATION!=='APPROVED_FROZEN_WINDOW'||!/^[a-f0-9-]{36}$/.test(maintenanceVersion||''))throw Error('Conflict or missing freeze authorization');
 const cf=JSON.parse(execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','auth','token','--json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,WRANGLER_WRITE_LOGS:'false',WRANGLER_SEND_METRICS:'false'}}));
 const origins=new Set(['https://qr-menu-ec.consola.workers.dev',...current.documents.filter(d=>d.path.startsWith('hostnames/')).map(d=>'https://'+d.fields.hostname.stringValue)]);
 async function authorizeWrites(){
  const response=await fetch('https://api.cloudflare.com/client/v4/accounts/088309af758852fcbfc714c622dff11d/workers/scripts/qr-menu-ec/deployments',{headers:{Authorization:`Bearer ${cf.token}`},signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('Cannot verify deployment');
  const payload=await response.json() as {result:{deployments:Array<{versions:Array<{version_id:string;percentage:number}>}>}};
  const active=payload.result.deployments[0].versions;
  if(active.length!==1||active[0].version_id!==maintenanceVersion||active[0].percentage!==100)throw Error('Write freeze is not exclusively active');
  for(const origin of origins){const r=await fetch(origin+'/api/owner/login',{redirect:'manual',signal:AbortSignal.timeout(10000)});if(r.status!==503||r.headers.get('X-QRMenu-Maintenance')!=='write-freeze-v1')throw Error('Domain not frozen');}
 }
 await authorizeWrites();
 const result=await withMigrationCredential(await migrationIam(),async(bearer:()=>Promise<string>)=>applyReconciliation(new FirestoreRest(current.project,'',bearer),baseline,current,{authorizeWrites,initialSnapshot:remote,excludedSubtrees,afterWrite:async completed=>console.log(JSON.stringify({stage:'reconciled-and-verified',completed,total:plan.writes.length}))}),credentialAudit);
 Object.assign(report,{result,remoteWrites:result.updatedDocuments});
}
await writeFile(output,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify(report,null,2));
if(plan.conflicts.length)process.exitCode=1;
