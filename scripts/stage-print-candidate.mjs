import { execFileSync } from 'node:child_process';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative, extname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const parent='fcea08f9-90ed-498c-b79f-6538ff8d6444';
const production='62bff004-11c0-4fa7-9047-b5a26a9cc0f1';
const account='088309af758852fcbfc714c622dff11d';
const base=`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/qr-menu-ec`;
const output='work/print-candidate-v2';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
if(!process.argv.includes('--upload-without-deploy'))throw Error('Explicit staging flag required');
const credential=JSON.parse(execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','auth','token','--json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,WRANGLER_WRITE_LOGS:'false',WRANGLER_SEND_METRICS:'false'}}));
async function api(path,init={}) {
 const url=path.startsWith('/beta/')?`https://api.cloudflare.com/client/v4/accounts/${account}/workers/workers/qr-menu-ec/${path.slice(6)}`:base+path;
 const r=await fetch(url,{...init,headers:{Authorization:`Bearer ${credential.token}`,...init.headers},signal:AbortSignal.timeout(60000)});
 if(!r.ok)throw Error(`Cloudflare HTTP ${r.status}`);return r;
}
const get=async path=>(await (await api(path)).json()).result;
const before=await get('/deployments');
if(before.deployments[0].versions.length!==1||before.deployments[0].versions[0].version_id!==production||before.deployments[0].versions[0].percentage!==100)throw Error('Production baseline changed');
const latest=(await get('/versions')).items[0].id;
if(![parent,'4a7e07ee-de83-4d13-9544-f9fcee40a128'].includes(latest))throw Error('Latest content cannot be safely attributed to accepted candidate');
const original=await get(`/versions/${parent}`);
const parts=await (await api('/content/v2')).formData();
const worker=Buffer.from(await parts.get('worker.js').arrayBuffer());
const accepted=JSON.parse(await readFile('work/migration-preparation/creator-transport-fix-version.json','utf8'));
if(hash(worker)!==accepted.workerSha256)throw Error('Accepted Worker checksum mismatch');
const assets=new Map();
async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){const file=join(dir,e.name);if(e.isDirectory())await walk(file);else if(e.isFile())assets.set('/'+relative('dist-worker',file).replaceAll('\\','/'),await readFile(file));else throw Error('Unexpected asset');}}
await walk('dist-worker');
function manifestOf(map){return Object.fromEntries([...map].map(([path,bytes])=>[path,{hash:hash(bytes.toString('base64')+extname(path).slice(1)).slice(0,32),size:bytes.length}]))}
if(hash(JSON.stringify(manifestOf(assets)))!==accepted.assetManifestSha256)throw Error('Accepted assets mismatch');
const source=await readFile('app/product.css','utf8');
const begin=source.indexOf('@media print {\n  .main > .card.qr-print-region');
const end=source.indexOf('\n.qr-payload summary',begin);
if(begin<0||end<begin)throw Error('Print block boundary mismatch');
const printCss=source.slice(begin,end);
if(!printCss.includes('font-size: 20pt'))throw Error('Readable WiFi typography missing');
const html=assets.get('/index.html').toString();
const cssPath=html.match(/<link[^>]+href="([^"]+\.css)"/)?.[1];
if(!cssPath||!assets.has(cssPath))throw Error('Stylesheet not found');
const css=Buffer.concat([assets.get(cssPath),Buffer.from('\n/* QR print: text/css verified */\n'+printCss+'\n')]);
const nextCssPath=`/assets/index-print-${hash(css).slice(0,12)}.css`;
assets.delete(cssPath);assets.set(nextCssPath,css);assets.set('/index.html',Buffer.from(html.replace(cssPath,nextCssPath).replace('</head>','<!-- QR print: text/html verified --></head>')));
await mkdir(output,{recursive:true});
await writeFile(`${output}/print.css`,printCss);await writeFile(`${output}/worker.js`,worker);
for(const[path,bytes]of assets){const dest=join(output,'assets',path);await mkdir(join(dest,'..'),{recursive:true});await writeFile(dest,bytes);}
const manifest=manifestOf(assets),byHash=new Map();
const types={'.js':'application/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.json':'application/json','.webmanifest':'application/manifest+json','.md':'text/markdown'};
for(const[path,bytes]of assets)byHash.set(manifest[path].hash,{bytes,type:types[extname(path)]||'application/octet-stream'});
const session=(await (await api('/assets-upload-session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({manifest})})).json()).result;
let completion=session.buckets.length?null:session.jwt;
for(const bucket of session.buckets){const data=new FormData();for(const key of bucket){const asset=byHash.get(key);data.append(key,new Blob([asset.bytes.toString('base64')],{type:asset.type}),key);}const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/assets/upload?base64=true`,{method:'POST',headers:{Authorization:`Bearer ${session.jwt}`},body:data,signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('Asset upload failed');const result=(await r.json()).result;if(result.jwt)completion=result.jwt;}
if(!completion||!isDeepStrictEqual(before,await get('/deployments'))||(await get('/versions')).items[0].id!==latest)throw Error('Concurrent staging change');
const metadata={main_module:'worker.js',modules:[{name:'worker.js',content_type:'application/javascript+module',content_base64:worker.toString('base64')}],bindings:original.resources.bindings.map(({name})=>({name,type:'inherit',version_id:parent})),compatibility_date:original.resources.script_runtime.compatibility_date,compatibility_flags:original.resources.script_runtime.compatibility_flags,assets:{jwt:completion,config:{run_worker_first:true,html_handling:original.resources.script_runtime.assets?.html_handling,not_found_handling:original.resources.script_runtime.assets?.not_found_handling}},annotations:{'workers/tag':'print-readable-candidate','workers/message':'Print-only responsive QR and 20pt WiFi; NO TRAFFIC'}};
const version=(await (await api('/beta/versions?deploy=false',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(metadata)})).json()).result.id;
const checked=await get(`/versions/${version}`);
const sort=rows=>[...rows].sort((a,b)=>a.name.localeCompare(b.name));
if(!isDeepStrictEqual(sort(checked.resources.bindings),sort(original.resources.bindings))||!isDeepStrictEqual(before,await get('/deployments')))throw Error('Bindings or production changed');
const result={checkedAt:new Date().toISOString(),candidateVersion:version,parentVersion:parent,workerSha256:hash(worker),workerUnchanged:true,bindingsUnchanged:true,productionUnchanged:true,trafficPercent:0,assetManifestSha256:hash(JSON.stringify(manifest)),printCssSha256:hash(printCss),stylesheet:nextCssPath};
await writeFile(`${output}/version.json`,JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result,null,2));
