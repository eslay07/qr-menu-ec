import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
const parent='b5cc3b53-5413-4431-9338-602888a88a48';
const token=randomBytes(32).toString('hex');
const expires=Date.now()+300000;
const source=`import { FirebaseAuthProvider } from './lib/firebase-auth-provider';
export default {async fetch(r,env){
 if(Date.now()>${expires} || r.headers.get('authorization')!=='Bearer '+env.AUTH_DIAGNOSTIC_TOKEN)return new Response(null,{status:404});
 const calls=[];
 const transport=async(url,init)=>{const response=await fetch(url,init);const u=new URL(url);let code=null,reason=null;
 if(!response.ok){const j=await response.clone().json().catch(()=>({}));const v=typeof j.error==='string'?j.error:j.error?.message;code=typeof v==='string'&&/^[A-Za-z0-9_ .:-]{1,120}$/.test(v)?v:'REDACTED_PROVIDER_ERROR';reason=j.error_description==='Invalid JWT Signature.'?'INVALID_JWT_SIGNATURE':null;}
 calls.push({host:u.hostname,operation:u.pathname.includes('lookup')?'lookup':u.pathname.includes('token')?'oauth':'other',status:response.status,code,reason});return response;};
 try{const p=new FirebaseAuthProvider(env,transport);const user=await p.lookup('owner:998d4980-a169-469f-b009-634a373ca7ad');return Response.json({ok:true,ownerExists:!!user,calls});}
 catch(e){return Response.json({ok:false,code:typeof e.code==='string'&&/^[A-Z_]{1,60}$/.test(e.code)?e.code:'UNCLASSIFIED',calls});}
}};`;
const bundle=await build({stdin:{contents:source,resolveDir:process.cwd(),sourcefile:'auth-diagnostic.ts',loader:'ts'},bundle:true,format:'esm',platform:'browser',target:'es2022',write:false});
const c=JSON.parse(execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','auth','token','--json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,WRANGLER_WRITE_LOGS:'false',WRANGLER_SEND_METRICS:'false'}}));
const root='https://api.cloudflare.com/client/v4/accounts/088309af758852fcbfc714c622dff11d/workers';
async function api(path,init={}){const r=await fetch(root+path,{...init,headers:{Authorization:'Bearer '+c.token,...init.headers},signal:AbortSignal.timeout(30000)});const j=await r.json();if(!r.ok||!j.success)throw Error('Cloudflare HTTP '+r.status);return j.result;}
const before=await api('/scripts/qr-menu-ec/deployments');
const active=before.deployments[0].versions;
if(active.length!==1||active[0].version_id!=='62bff004-11c0-4fa7-9047-b5a26a9cc0f1'||active[0].percentage!==100)throw Error('Unexpected production');
const version=await api('/scripts/qr-menu-ec/versions/'+parent);
const keep=['AUTH_PROVIDER','FIREBASE_PROJECT_ID','FIREBASE_API_KEY','FIREBASE_SERVICE_ACCOUNT'];
const bindings=keep.map(name=>({name,type:'inherit',version_id:parent}));
bindings.push({name:'AUTH_DIAGNOSTIC_TOKEN',type:'secret_text',text:token});
const created=await api('/workers/qr-menu-ec/versions?deploy=false',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({main_module:'diagnostic.js',modules:[{name:'diagnostic.js',content_type:'application/javascript+module',content_base64:Buffer.from(bundle.outputFiles[0].contents).toString('base64')}],bindings,compatibility_date:version.resources.script_runtime.compatibility_date,compatibility_flags:version.resources.script_runtime.compatibility_flags,annotations:{'workers/tag':'private-auth-diagnostic','workers/message':'Read-only Auth diagnostic, protected and expires in 5 minutes. NEVER DEPLOY.'}})});
const url='https://'+created.id.slice(0,8)+'-qr-menu-ec.consola.workers.dev';
const r=await fetch(url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});
const report={checkedAt:new Date().toISOString(),diagnosticVersion:created.id,expiresAt:new Date(expires).toISOString(),httpStatus:r.status,result:await r.json(),productionUnchanged:isDeepStrictEqual(before,await api('/scripts/qr-menu-ec/deployments')),dataWrites:0};
await writeFile('work/migration-preparation/auth-runtime-diagnosis.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
