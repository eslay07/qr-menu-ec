import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { firestoreBearer } from '../lib/firestore-credentials.ts';
import { migrationStage } from './migration-diagnostics.mjs';
import { freshCredentialReady } from './fresh-credential-readiness.mjs';
const require=createRequire(import.meta.url);
export const migrationProject='qr-menu-6981a';
export const migrationIdentity=`qrmenu-firestore-worker@${migrationProject}.iam.gserviceaccount.com`;
const resource=`projects/${migrationProject}/serviceAccounts/${migrationIdentity}`;

export async function migrationIam() {
  const auth=require('firebase-tools/lib/auth');
  await require('firebase-tools/lib/requireAuth').requireAuth({project:migrationProject,nonInteractive:true,...auth.getProjectDefaultAccount(process.cwd())});
  const {getAccessToken}=require('firebase-tools/lib/apiv2');
  async function call(path,method='GET',body) {
    const response=await fetch(`https://iam.googleapis.com/v1/${path}`,{method,
      headers:{Authorization:`Bearer ${await getAccessToken()}`,'Content-Type':'application/json'},
      ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
    if(response.status===404&&method==='DELETE')return {};
    if(!response.ok){const body=await response.json().catch(()=>({}));throw Object.assign(Error('IAM operation unavailable'),{status:response.status,code:body.error?.status});}
    return response.json();
  }
  return {
    async check() {
      const permissions=['iam.serviceAccountKeys.create','iam.serviceAccountKeys.delete','iam.serviceAccountKeys.list'];
      const result=await call(`${resource}:testIamPermissions`,'POST',{permissions});
      if(!permissions.every(p=>result.permissions?.includes(p)))throw Error('Temporary key permissions unavailable');
      const account=await call(resource);
      if(account.disabled||account.email!==migrationIdentity)throw Error('Dedicated identity unavailable');
      const response=await fetch(`https://cloudresourcemanager.googleapis.com/v1/projects/${migrationProject}:getIamPolicy`,{method:'POST',headers:{Authorization:`Bearer ${await getAccessToken()}`,'Content-Type':'application/json'},body:JSON.stringify({options:{requestedPolicyVersion:3}}),signal:AbortSignal.timeout(20000)});
      if(!response.ok)throw Error('Cannot verify dedicated role');
      const policy=await response.json();
      const grants=(policy.bindings||[]).filter(b=>b.members?.includes(`serviceAccount:${migrationIdentity}`));
      if(grants.length!==1||grants[0].role!=='roles/datastore.user'||grants[0].condition)throw Error('Dedicated role changed');
      return {identity:migrationIdentity,role:'roles/datastore.user',temporaryKeyPermissions:true};
    },
    async create(){
      const key=await call(`${resource}/keys`,'POST',{privateKeyType:'TYPE_GOOGLE_CREDENTIALS_FILE',keyAlgorithm:'KEY_ALG_RSA_2048'});
      // IAM may use the numeric account ID in the returned resource name.
      // Requests are pinned to the dedicated identity; address its returned
      // key ID through that identity instead of accepting arbitrary resources.
      const id=key.name?.split('/').at(-1);
      if(!id||!/^[a-zA-Z0-9_-]+$/.test(id))throw Error('Unrecognized created key ID; review IAM before proceeding');
      return {...key,name:`${resource}/keys/${id}`};
    },
    async remove(name){
      if(!name.startsWith(`${resource}/keys/`))throw Error('Unexpected key identity');
      await call(name,'DELETE');
      const remaining=await call(`${resource}/keys?keyTypes=USER_MANAGED`);
      if(remaining.keys?.some(k=>k.name.split('/').at(-1)===name.split('/').at(-1)))throw Error('Key deletion not confirmed');
    },
  };
}

// Key and bearer are closure-local, never arguments, environment variables,
// stdout, disk or inherited subprocess state. Audit contains only key metadata.
export async function withMigrationCredential(iam, task, audit, makeBearer=firestoreBearer) {
  await migrationStage('credential.permissions',()=>iam.check());
  let keyName, bytes, secret;
  let revoked=false;
  try {
    const key=await migrationStage('credential.create',()=>iam.create());
    keyName=key.name;
    if(!keyName?.startsWith(`${resource}/keys/`))throw Error('Unexpected temporary key');
    bytes=Buffer.from(key.privateKeyData,'base64');
    key.privateKeyData=undefined;
    secret=bytes.toString('utf8');
    await migrationStage('credential.decode-and-identity',async()=>{
      const identity=JSON.parse(secret);
      if(identity.client_email!==migrationIdentity||identity.project_id!==migrationProject)throw Error('Credential identity mismatch');
    });
    await audit({keyName,status:'created',createdAt:new Date().toISOString()});
    const bearer=await migrationStage('credential.bearer-provider',async()=>makeBearer(migrationProject,secret));
    await migrationStage('credential.wait-for-new-key-propagation',()=>freshCredentialReady(bearer,{report:result=>console.log(JSON.stringify({stage:'credential.oauth-readiness',...result}))}));
    return await task(bearer);
  } finally {
    bytes?.fill(0);secret=undefined;
    if(keyName) {
      for(let attempt=0;attempt<3&&!revoked;attempt++) {
        try {await migrationStage('credential.revoke',()=>iam.remove(keyName));revoked=true;} catch {if(attempt<2)await new Promise(r=>setTimeout(r,1000*(attempt+1)));}
      }
      await audit({keyName,status:revoked?'revoked':'REVOCATION_REQUIRED',checkedAt:new Date().toISOString()});
      if(!revoked)throw Error('Temporary key revocation required; keep maintenance and inspect local audit');
    }
  }
}

export async function credentialAudit(record) {
  await mkdir('work/migration-preparation',{recursive:true});
  await writeFile('work/migration-preparation/temporary-credential.json',JSON.stringify(record,null,2));
}
