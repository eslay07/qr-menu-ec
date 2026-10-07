import { execFileSync } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
const account='088309af758852fcbfc714c622dff11d',baseline='724862e7-0c75-4bdd-b01a-4067891f78fe';
let token;
const authenticate=()=>{token=JSON.parse(execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','auth','token','--json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,WRANGLER_WRITE_LOGS:'false',WRANGLER_SEND_METRICS:'false'}})).token;};
authenticate();
export async function cf(path,method='GET',body,retry=true){
 const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60000)});
 if(response.status===401&&retry){authenticate();return cf(path,method,body,false);}
 const result=await response.json();
 if(!response.ok||result.success===false){const constraint=(result.errors||[]).some(e=>/CHECK constraint failed.*ok/i.test(e.message));throw Error(constraint?'CHECK constraint failed: ok':`Cloudflare operation failed HTTP ${response.status}; codes ${(result.errors||[]).map(e=>e.code).join(',')}`);}
 return result.result;
}
export async function unchangedProduction(){const deployments=await cf('/workers/scripts/qr-menu-ec/deployments');const versions=deployments.deployments[0].versions;if(versions.length!==1||versions[0].version_id!==baseline||versions[0].percentage!==100)throw Error('Production baseline changed.');return deployments;}
export function remoteD1(id){
 if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid D1 identity.');
 function prepared(sql){let values=[];return {
  bind(...input){values=input;return this;},
  async first(){return (await cf(`/d1/database/${id}/query`,'POST',{sql,params:values}))[0].results[0]||null;},
  async all(){return (await cf(`/d1/database/${id}/query`,'POST',{sql,params:values}))[0];},
  async run(){return (await cf(`/d1/database/${id}/query`,'POST',{sql,params:values}))[0];},
  toQuery(){return {sql,params:values};}
 };}
 return {prepare:prepared,async batch(statements){return cf(`/d1/database/${id}/query`,'POST',{batch:statements.map(statement=>statement.toQuery())});}};
}

if(process.argv.includes('--prepare-isolated')){
 const before=await unchangedProduction();
 const databases=await cf('/d1/database?per_page=100');
 const matches=databases.filter(row=>row.name==='qr-menu-operational-documents');
 if(matches.length>1)throw Error('Ambiguous operational database.');
 let database=matches[0];
 if(!database){if(databases.length>=10)throw Error('Free D1 database capacity requires review.');database=await cf('/d1/database','POST',{name:'qr-menu-operational-documents',primary_location_hint:'enam'});}
 const id=database.uuid;
 if(!id||id==='e81ee150-55f7-434f-84de-299b2d001f1c')throw Error('Invalid isolated destination.');
 const tables=await cf(`/d1/database/${id}/query`,'POST',{sql:"SELECT name FROM sqlite_master WHERE type='table'"});
 if(tables[0].results.some(row=>!row.name.startsWith('_cf_')&&!row.name.startsWith('sqlite_')&&!row.name.startsWith('operational_')))throw Error('Unexpected tables in isolated destination.');
 await cf(`/d1/database/${id}/query`,'POST',{sql:await readFile('deployment/cloudflare/d1-documents.sql','utf8')});
 const count=await remoteD1(id).prepare('SELECT count(*) AS n FROM operational_documents').first();
 const after=await unchangedProduction();
 if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Concurrent production change.');
 const receipt={checkedAt:new Date().toISOString(),databaseId:id,name:database.name,documentCount:count.n,legacyMediaUntouched:true,productionUnchanged:true};
 await mkdir('work/d1-transition',{recursive:true});await writeFile('work/d1-transition/destination.json',JSON.stringify(receipt,null,2));
 console.log(JSON.stringify(receipt,null,2));
}
