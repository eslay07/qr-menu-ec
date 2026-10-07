import { migrationIam, withMigrationCredential, credentialAudit, migrationProject, migrationIdentity } from './migration-credential.mjs';
import { migrationStage, safeMigrationError } from './migration-diagnostics.mjs';
import { FirestoreRest } from '../lib/firestore-rest.ts';
import { firestoreBearer } from '../lib/firestore-credentials.ts';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { inspectPlanUntilFirstWrite } from './migration-read-only-plan.mjs';

if(process.argv[2]!=='--read-only')throw Error('Read-only mode required');
const result={startedAt:new Date().toISOString(),project:migrationProject,identity:migrationIdentity,documentWrites:0};
let permissionsBearer;
// Independent transport barrier in addition to blocked repository commits.
const nativeFetch=globalThis.fetch;
globalThis.fetch=(input,init)=>{
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
  const method=(init?.method??'GET').toUpperCase();
  if(url.hostname==='firestore.googleapis.com'&&method!=='GET'&&!(method==='POST'&&url.pathname.endsWith(':listCollectionIds')))throw Error('Dry-run transport refuses Firestore writes');
  return nativeFetch(input,init);
};
try {
  await withMigrationCredential(await migrationIam(),async(bearer)=>{
    const token=await migrationStage('preflight.oauth-exchange',bearer);
    async function read(label,url,init={}) {
      return migrationStage(label,async()=>{
        const bearerToken=label==='preflight.permissions'?await permissionsBearer():token;
        const response=await fetch(url,{...init,headers:{Authorization:`Bearer ${bearerToken}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(20000)});
        const body=await response.json();
        result[label]={httpStatus:response.status};
        if(!response.ok)throw Object.assign(Error('Remote preflight failed'),{status:response.status,code:body.error?.status});
        return body;
      });
    }
    const database=await read('preflight.database','https://firestore.googleapis.com/v1/projects/'+migrationProject+'/databases/(default)');
    result.databaseCorrect=database.name===`projects/${migrationProject}/databases/(default)`;
    const db=new FirestoreRest(migrationProject,'',async()=>token);
    const docs=await migrationStage('preflight.document-inventory',()=>db.inventoryWire());
    result.documents=docs.length;
    const permissions=['datastore.entities.get','datastore.entities.list','datastore.entities.create','datastore.entities.update','datastore.entities.delete'];
    const access=await read('preflight.permissions',`https://cloudresourcemanager.googleapis.com/v3/projects/${migrationProject}:testIamPermissions`,{method:'POST',body:JSON.stringify({permissions})});
    result.permissions=Object.fromEntries(permissions.map(p=>[p,access.permissions?.includes(p)??false]));
    if(process.argv[3]){
      const encrypted=await readFile(process.argv[3]);
      const bytes=Buffer.from(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','Add-Type -AssemblyName System.Security; $diagnosticBytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); [Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($diagnosticBytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))'],{input:encrypted.toString('base64'),encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:100000000}),'base64');
      let plan;try{plan=JSON.parse(bytes.toString());}finally{bytes.fill(0);}
      result.plan=await inspectPlanUntilFirstWrite(db,plan,process.argv[4]);
    }
    result.passed=result.databaseCorrect&&Object.values(result.permissions).every(Boolean);
  },credentialAudit,(project,secret)=>{
    permissionsBearer=firestoreBearer(project,secret,'https://www.googleapis.com/auth/iam.test');
    return firestoreBearer(project,secret); // EXACT scope used by the real importer.
  });
  result.temporaryCredentialRevoked=true;
}catch(error){result.passed=false;result.error=safeMigrationError(error);process.exitCode=1;}
result.finishedAt=new Date().toISOString();
await mkdir('work/migration-preparation',{recursive:true});
await writeFile('work/migration-preparation/identity-dry-run.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
