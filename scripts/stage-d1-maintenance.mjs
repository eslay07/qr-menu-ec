import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { build } from 'esbuild';

const production = '62bff004-11c0-4fa7-9047-b5a26a9cc0f1';
const candidate = process.argv[3] || 'e6d9a9b6-66c3-476c-a586-2d5b72157a10';
const receiptPath = process.argv[4] || 'work/migration-preparation/maintenance-version-v2.json';
if(!/^[a-f0-9-]{36}$/.test(candidate)||!/^work\/[a-zA-Z0-9/_.-]+\.json$/.test(receiptPath)||receiptPath.includes('..'))throw Error('Invalid staging arguments');
let stage = 'authorization', createdVersion;
try {
  if (process.argv[2] !== '--stage-only') throw Error('Staging authorization required');
  if (await access(receiptPath).then(() => true, () => false)) throw Error('Existing receipt: review before another upload');
  const credential = JSON.parse(execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js','auth','token','--json'], { encoding:'utf8', stdio:['ignore','pipe','pipe'], env:{...process.env,WRANGLER_WRITE_LOGS:'false',WRANGLER_SEND_METRICS:'false'} }));
  const base = 'https://api.cloudflare.com/client/v4/accounts/088309af758852fcbfc714c622dff11d/workers/scripts/qr-menu-ec';
  async function api(path, init={}) {
    const r=await fetch(base+path,{...init,headers:{Authorization:`Bearer ${credential.token}`,...init.headers},signal:AbortSignal.timeout(60000)});
    if(!r.ok) { const failure=await r.json().catch(()=>({})); console.error(JSON.stringify({stage,httpStatus:r.status,errors:failure.errors?.map(e=>({code:e.code,message:String(e.message||'').replaceAll(credential.token,'[redacted]').slice(0,900)}))})); throw Error('Cloudflare request failed'); }
    return r;
  }
  async function get(path) { return (await (await api(path)).json()).result; }
  stage='baseline';
  const before=await get('/deployments');
  const active=before.deployments[0];
  if(active.versions.length!==1||active.versions[0].version_id!==production||active.versions[0].percentage!==100)throw Error('Active baseline changed');
  if((await get('/versions')).items[0].id!==candidate)throw Error('Unexpected latest version');
  const source=await get(`/versions/${production}`);
  const db=source.resources.bindings.find(b=>b.name==='DB'&&b.type==='d1');
  if(!db || source.resources.bindings.some(b=>b.name==='DATA_PROVIDER'&&b.text!=='d1'))throw Error('D1 baseline required');
  if(JSON.stringify([...source.resources.script.handlers].sort((a,b)=>a.localeCompare(b)))!==JSON.stringify(['fetch','scheduled']))throw Error('Unhandled event types');
  const compiled=await build({entryPoints:['deployment/cloudflare/maintenance-only.ts'],bundle:true,format:'esm',platform:'browser',write:false});
  const bytes=compiled.outputFiles[0].contents;
  const sha=buffer=>createHash('sha256').update(buffer).digest('hex');
  const form=new FormData();
  form.append('maintenance.js',new Blob([bytes],{type:'application/javascript+module'}),'maintenance.js');
  // Only D1 is retained for provenance. This handler never accesses it. No
  // assets, secrets or migrated code can bypass the unconditional 503 gate.
  const bindings=[db,
    {name:'DATA_PROVIDER',type:'plain_text',text:'d1'},
    {name:'MAINTENANCE_MODE',type:'plain_text',text:'true'},
    {name:'FCM_ENABLED',type:'plain_text',text:'false'}];
  form.append('metadata',JSON.stringify({main_module:'maintenance.js',bindings,
    compatibility_date:source.resources.script_runtime.compatibility_date,
    compatibility_flags:source.resources.script_runtime.compatibility_flags,
    annotations:{'workers/tag':'d1-maintenance-ready','workers/message':`Maintenance only, based on D1 ${production}; 0% until separately authorized; restore original version to exit`}}));
  if(!isDeepStrictEqual(before,await get('/deployments'))||(await get('/versions')).items[0].id!==candidate)throw Error('Concurrent change');
  stage='upload-version-only';
  createdVersion=(await (await api('/versions?bindings_inherit=strict',{method:'POST',body:form})).json()).result.id;
  stage='verify';
  const uploaded=await get(`/versions/${createdVersion}`);
  if(!isDeepStrictEqual(uploaded.resources.bindings.find(b=>b.name==='DB'),db))throw Error('D1 binding differs');
  for(const expected of bindings.filter(b=>b.type==='plain_text'))if(!uploaded.resources.bindings.some(b=>isDeepStrictEqual(b,expected)))throw Error('Flags differ');
  if(uploaded.resources.bindings.length!==4||uploaded.resources.script_runtime.assets)throw Error('Unexpected bindings/assets');
  if((await get('/versions')).items[0].id!==createdVersion)throw Error('Concurrent version');
  const content=await (await api('/content/v2')).formData();
  const uploadedBytes=Buffer.from(await content.get('maintenance.js').arrayBuffer());
  if(sha(uploadedBytes)!==sha(bytes))throw Error('Uploaded checksum differs');
  if(!isDeepStrictEqual(before,await get('/deployments')))throw Error('Deployment changed');
  const receipt={checkedAt:new Date().toISOString(),maintenanceVersion:createdVersion,baselineVersion:production,candidateVersion:'22052178-361a-4546-9193-8cb47deb2f0c',
    sha256:sha(bytes),d1BindingPreserved:true,handler:'unconditional-503-and-no-op-scheduled',assetsServed:false,secretsCopied:false,
    activeTraffic:100,maintenanceTraffic:0,candidateTraffic:0,productionUnchanged:true,activationRequested:false};
  await mkdir('work/migration-preparation',{recursive:true});
  await writeFile(receiptPath,JSON.stringify(receipt,null,2),{flag:'wx'});
  console.log(JSON.stringify(receipt,null,2));
} catch {console.error(JSON.stringify({completed:false,stage,createdVersion:createdVersion??null,activationRequested:false}));process.exitCode=1;}
