import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
const parent='22052178-361a-4546-9193-8cb47deb2f0c';
const credential=JSON.parse(execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','auth','token','--json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,WRANGLER_WRITE_LOGS:'false',WRANGLER_SEND_METRICS:'false'}}));
const root='https://api.cloudflare.com/client/v4/accounts/088309af758852fcbfc714c622dff11d/workers';
async function api(path,init={}) {
 const r=await fetch(root+path,{...init,headers:{Authorization:`Bearer ${credential.token}`,...init.headers},signal:AbortSignal.timeout(30000)});
 const body=await r.json().catch(()=>({}));
 if(!r.ok||!body.success)throw Object.assign(Error('Cloudflare operation rejected'),{status:r.status,codes:(body.errors||[]).map(e=>e.code)});
 return body.result;
}
const before=await api('/scripts/qr-menu-ec/deployments');
const active=before.deployments[0].versions;
if(active.length!==1||active[0].version_id!=='62bff004-11c0-4fa7-9047-b5a26a9cc0f1'||active[0].percentage!==100)throw Error('Unexpected production');
const original=await api('/scripts/qr-menu-ec/versions/'+parent);
const local=await readFile('.env.local','utf8');
const val=name=>local.split('\n').find(l=>l.startsWith(name+'='))?.slice(name.length+1).trim().replace(/^["']|["']$/g,'');
if(val('VITE_FIREBASE_PROJECT_ID')!=='qr-menu-6981a'||!val('VITE_FIREBASE_API_KEY'))throw Error('Firebase local config mismatch');
const vars={AUTH_PROVIDER:'firebase',FIREBASE_PROJECT_ID:'qr-menu-6981a',FIREBASE_API_KEY:val('VITE_FIREBASE_API_KEY'),MAINTENANCE_MODE:'false'};
let result;
try {
 // Wrangler uses this version-scoped merge-patch endpoint for non-deploying
 // secret updates. Pin the historical candidate; never patch latest/production.
 const created=await api('/workers/qr-menu-ec/versions/'+parent,{method:'PATCH',headers:{'Content-Type':'application/merge-patch+json'},body:JSON.stringify({env:Object.fromEntries(Object.entries(vars).map(([name,text])=>[name,{type:'plain_text',text}])),annotations:{'workers/message':'Firebase Auth candidate only; preserve historical bindings; NO TRAFFIC','workers/tag':'auth-candidate'}})});
 const id=created.id;
 if(!id||id===parent)throw Error('New version not confirmed');
 const checked=await api('/scripts/qr-menu-ec/versions/'+id);
 const sort=bs=>bs.filter(b=>!Object.hasOwn(vars,b.name)).sort((a,b)=>a.name.localeCompare(b.name));
 const preserved=isDeepStrictEqual(sort(original.resources.bindings),sort(checked.resources.bindings));
 const variablesCorrect=Object.entries(vars).every(([name,text])=>checked.resources.bindings.some(b=>b.name===name&&b.text===text));
 result={candidateVersion:id,otherBindingsPreserved:preserved,variablesCorrect};
}catch(e){result={blocked:true,httpStatus:e.status||null,codes:e.codes||[],newVersionConfirmed:false};}
result.productionUnchanged=isDeepStrictEqual(before,await api('/scripts/qr-menu-ec/deployments'));
result.checkedAt=new Date().toISOString();
await writeFile('work/migration-preparation/auth-patch-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
if(result.blocked||!result.productionUnchanged||!result.otherBindingsPreserved||!result.variablesCorrect)process.exitCode=1;
