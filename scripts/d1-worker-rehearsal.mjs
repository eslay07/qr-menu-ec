import {build} from 'esbuild';
import {randomBytes} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {cf,remoteD1,unchangedProduction} from './d1-transition-operator.mjs';
import {D1DocumentStore} from '../lib/d1-documents.ts';
const database=JSON.parse(await readFile('work/d1-transition/destination.json','utf8')).databaseId;
if(database!=='0c8dab0c-5e79-4272-a28c-90b00a93e676')throw Error('Unexpected isolated destination.');
const db=new D1DocumentStore(remoteD1(database));
if((await db.inventoryWire()).length)throw Error('Isolated destination must be empty.');
await unchangedProduction();
const name='qr-menu-d1-runtime-rehearsal';
const workers=await cf('/workers/scripts');
if(workers.some(worker=>worker.id===name))throw Error('Test worker already exists; do not overwrite.');
if(workers.length>=100)throw Error('Free Worker capacity requires review.');
const bundle=await build({entryPoints:['deployment/cloudflare/d1-rehearsal.ts'],bundle:true,format:'esm',platform:'browser',write:false,target:'es2022'});
const token=randomBytes(32).toString('hex'),form=new FormData();
form.set('metadata',JSON.stringify({main_module:'worker.js',compatibility_date:'2026-09-27',bindings:[{name:'DOCUMENT_DB',type:'d1',id:database},{name:'REHEARSAL_TOKEN',type:'secret_text',text:token}]}));
form.set('worker.js',new Blob([bundle.outputFiles[0].text],{type:'application/javascript+module'}),'worker.js');
// Multipart cannot use the operator JSON wrapper; credential stays in memory.
const {execFileSync}=await import('node:child_process');
const auth=JSON.parse(execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','auth','token','--json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,WRANGLER_WRITE_LOGS:'false',WRANGLER_SEND_METRICS:'false'}}));
const created=await fetch(`https://api.cloudflare.com/client/v4/accounts/088309af758852fcbfc714c622dff11d/workers/scripts/${name}`,{method:'PUT',headers:{Authorization:`Bearer ${auth.token}`},body:form,signal:AbortSignal.timeout(60000)});
if(!created.ok)throw Error(`Test worker creation HTTP ${created.status}`);
const result=await created.json();if(!result.success)throw Error('Test worker creation unconfirmed.');
let receipt;
try{
 await cf(`/workers/scripts/${name}/subdomain`,'POST',{enabled:true});
 const checks=[];
 for(const path of ['/prepare','/publish','/read']){
  let response,body;
  for(let attempt=0;attempt<6;attempt++){
   response=await fetch(`https://${name}.consola.workers.dev${path}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(60000)});
   if(response.headers.get('content-type')?.includes('application/json')){body=await response.json();break;}
   await response.arrayBuffer();
   console.log(JSON.stringify({stage:'test-worker-propagation',status:response.status,attempt:attempt+1}));
   if(attempt<5)await new Promise(resolve=>setTimeout(resolve,3000));
  }
  body??={passed:false,error:'Test worker did not serve JSON after bounded propagation retries.'};
  checks.push({path,status:response.status,...body});
  if(!response.ok||body.passed!==true)break;
 }
 receipt={checkedAt:new Date().toISOString(),checks,passed:checks.length===3&&checks.every(check=>check.passed),productionUnchanged:true};
}finally{
 await cf(`/workers/scripts/${name}`,'DELETE');
 const rows=await db.inventoryWire();
 const id='00000000-0000-4000-8000-000000000001';
 if(rows.some(row=>!row.path.startsWith(`restaurants/${id}/`)&&row.path!==`restaurants/${id}`&&!row.path.startsWith(`publicMenus/${id}/`)&&row.path!==`publicMenus/${id}`))throw Error('Unexpected documents; refusing cleanup.');
 for(let i=0;i<rows.length;i+=40)await db.commit(rows.slice(i,i+40).map(row=>({path:row.path,delete:true,updateTime:row.updateTime})));
 if((await db.inventoryWire()).length)throw Error('Test cleanup incomplete.');
 await unchangedProduction();
}
await writeFile('work/d1-transition/worker-rehearsal.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt,null,2));
if(!receipt?.passed)process.exitCode=1;
