import { build } from 'esbuild';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
const parent = '724862e7-0c75-4bdd-b01a-4067891f78fe';
const token = randomBytes(32).toString('hex'), expires = Date.now() + 300_000;
const source = `import { localFirestore } from './lib/application-repository';
import { FirestoreRestaurantStore } from './lib/firestore-store';
export default { async fetch(request, env) {
 if (Date.now() > ${expires} || request.headers.get('authorization') !== 'Bearer ' + env.DIAGNOSTIC_TOKEN) return new Response(null,{status:404});
 const failures=[]; const transport=globalThis.fetch;
 globalThis.fetch=async function(url,init){const response=await transport.call(globalThis,url,init);
  if(!response.ok){const j=await response.clone().json().catch(()=>({})); failures.push({status:response.status,code:j.error?.status,operation:String(url).includes(':runQuery')?'query':String(url).includes('/token')?'oauth':String(url).includes('pageSize')?'list':'get',googleFirestore:String(url).startsWith('https://firestore.googleapis.com/'), message:typeof j.error?.message==='string'?j.error.message.slice(0,1500):null,details:j.error?.details?.filter(d=>String(d['@type']).includes('QuotaFailure')||String(d['@type']).includes('ErrorInfo'))});} return response;};
 try { const state=await new FirestoreRestaurantStore(localFirestore(env),'998d4980-a169-469f-b009-634a373ca7ad',{}).read(); return Response.json({readable:!!state,failures}); }
 catch(error){const identity=JSON.parse(env.FIRESTORE_SERVICE_ACCOUNT);return Response.json({readable:false,type:error.name,failures,projectMatches:env.FIRESTORE_PROJECT_ID==='qr-menu-6981a',identityMatches:identity.client_email==='qrmenu-firestore-worker@qr-menu-6981a.iam.gserviceaccount.com'});}
 finally {globalThis.fetch=transport;}
}};`;
const bundle = await build({ stdin: { contents: source, resolveDir: process.cwd(), sourcefile: 'readonly-diagnostic.ts', loader: 'ts' }, bundle: true, platform: 'browser', format: 'esm', target: 'es2022', write: false });
const credential = JSON.parse(execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js','auth','token','--json'], { encoding: 'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,WRANGLER_WRITE_LOGS:'false'} }));
const base='https://api.cloudflare.com/client/v4/accounts/088309af758852fcbfc714c622dff11d/workers';
async function api(path, init={}) {const r=await fetch(base+path,{...init,headers:{Authorization:'Bearer '+credential.token,...init.headers},signal:AbortSignal.timeout(30000)});const j=await r.json();if(!r.ok||!j.success)throw Error('Diagnostic staging failed '+r.status);return j.result;}
const before=await api('/scripts/qr-menu-ec/deployments');
if(before.deployments[0].versions.length!==1||before.deployments[0].versions[0].version_id!==parent||before.deployments[0].versions[0].percentage!==100)throw Error('Production baseline changed');
const original=await api('/scripts/qr-menu-ec/versions/'+parent);
const bindings=['DATA_PROVIDER','FIRESTORE_PROJECT_ID','FIRESTORE_REMOTE_ENABLED','FIRESTORE_SERVICE_ACCOUNT'].map(name=>({name,type:'inherit',version_id:parent}));
bindings.push({name:'DIAGNOSTIC_TOKEN',type:'secret_text',text:token});
const version=await api('/workers/qr-menu-ec/versions?deploy=false',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({main_module:'diagnostic.js',modules:[{name:'diagnostic.js',content_type:'application/javascript+module',content_base64:Buffer.from(bundle.outputFiles[0].contents).toString('base64')}],bindings,compatibility_date:original.resources.script_runtime.compatibility_date,compatibility_flags:original.resources.script_runtime.compatibility_flags,annotations:{'workers/tag':'readonly-firestore-diagnostic','workers/message':'Read-only protected quota diagnostic; expires in 5 minutes; NEVER DEPLOY'}})});
const response=await fetch('https://'+version.id.slice(0,8)+'-qr-menu-ec.consola.workers.dev',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(45000)});
const receipt={checkedAt:new Date().toISOString(),diagnosticVersion:version.id,expiresAt:new Date(expires).toISOString(),httpStatus:response.status,result:await response.json(),productionUnchanged:isDeepStrictEqual(before,await api('/scripts/qr-menu-ec/deployments')),dataWrites:0};
await mkdir('work/firestore-runtime-diagnostic',{recursive:true});await writeFile('work/firestore-runtime-diagnostic/result.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt,null,2));
