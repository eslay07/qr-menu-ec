import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { FirestoreRest } from '../lib/firestore-rest.ts';
const require = createRequire(import.meta.url);
const project = 'qr-menu-6981a';
const hidden = () => ({ skipLog: { reqBody: true, resBody: true }, resolveOnHTTPError: true });
const hash = value => createHash('sha256').update(value).digest('hex');
let stage = 'authentication', diagnostic;
try {
  const auth = require('firebase-tools/lib/auth');
  await require('firebase-tools/lib/requireAuth').requireAuth({ project, nonInteractive:true, ...auth.getProjectDefaultAccount(process.cwd()) });
  const { Client, getAccessToken } = require('firebase-tools/lib/apiv2');
  const rules = new Client({urlPrefix:'https://firebaserules.googleapis.com',apiVersion:'v1'});
  const fs = new Client({urlPrefix:'https://firestore.googleapis.com',apiVersion:'v1'});
  const iam = new Client({urlPrefix:'https://iam.googleapis.com',apiVersion:'v1'});
  const rm = new Client({urlPrefix:'https://cloudresourcemanager.googleapis.com',apiVersion:'v1'});
  stage = 'step4-rules';
  const release = await rules.get(`projects/${project}/releases/cloud.firestore`,hidden());
  let rulesMatch = false, deployedRulesSha256 = null;
  if (release.status === 200) {
    const set = await rules.get(release.body.rulesetName,hidden());
    if (set.status !== 200) throw Error('Cannot read active rules.');
    const files = set.body.source?.files || [];
    const local = (await readFile('src/lib/firebase.rules','utf8')).replaceAll('\r\n','\n').trim();
    if (files.length === 1) { const remote=files[0].content.replaceAll('\r\n','\n').trim(); rulesMatch=local===remote; deployedRulesSha256=hash(remote); }
  } else if (release.status !== 404) throw Error('Cannot inspect active rules.');
  console.log(JSON.stringify({step:'4-rules',releasePresent:release.status===200,rulesMatch}));
  stage = 'step4-composite-indexes';
  const config = JSON.parse(await readFile('firestore.indexes.json','utf8'));
  const indexes = [];
  let token;
  do {
    // This Admin endpoint currently accepts only default page size (0).
    const response = await fs.get(`projects/${project}/databases/(default)/collectionGroups/-/indexes`,{...hidden(),...(token?{queryParams:{pageToken:token}}:{})});
    if(response.status!==200){diagnostic={httpStatus:response.status,code:response.body?.error?.status,message:String(response.body?.error?.message||'').replaceAll(project,'[project]').slice(0,800)};throw Error('Cannot inventory indexes.');}
    indexes.push(...(response.body.indexes||[])); token=response.body.nextPageToken;
  } while(token);
  function fields(list) { const copy=[...list]; if(!copy.some(f=>f.fieldPath==='__name__'))copy.push({fieldPath:'__name__',order:copy.at(-1)?.order||'ASCENDING'}); return JSON.stringify(copy.map(f=>({fieldPath:f.fieldPath,order:f.order,arrayConfig:f.arrayConfig}))); }
  const indexChecks=config.indexes.map(expected=>{
    const found=indexes.find(i=>i.name.includes(`/collectionGroups/${expected.collectionGroup}/indexes/`)&&i.queryScope===expected.queryScope&&fields(i.fields)===fields(expected.fields));
    return {collection:expected.collectionGroup,name:found?.name??null,state:found?.state??'MISSING',present:!!found,ready:found?.state==='READY'};
  });
  const fieldChecks=[];
  for(const expected of config.fieldOverrides){
    stage=`step4-field-${expected.collectionGroup}-${expected.fieldPath}`;
    const response=await fs.get(`projects/${project}/databases/(default)/collectionGroups/${expected.collectionGroup}/fields/${encodeURIComponent(expected.fieldPath)}`,hidden());
    if(response.status!==200){diagnostic={httpStatus:response.status,code:response.body?.error?.status};throw Error('Cannot inspect index override.');}
    const indexes=response.body.indexConfig?.indexes||[];
    const normalize=rows=>rows.map(i=>JSON.stringify({order:i.order,arrayConfig:i.arrayConfig,queryScope:i.queryScope})).sort();
    const actual=indexes.map(i=>({...i,...i.fields?.find(f=>f.fieldPath===expected.fieldPath)}));
    fieldChecks.push({collection:expected.collectionGroup,field:expected.fieldPath,states:indexes.map(i=>i.state??null),indexCount:indexes.length,correct:JSON.stringify(normalize(actual))===JSON.stringify(normalize(expected.indexes))&&indexes.every(i=>!i.state||i.state==='READY')});
  }
  stage='step4-permissions';
  const member=`serviceAccount:qrmenu-firestore-worker@${project}.iam.gserviceaccount.com`;
  const policy=await rm.post(`projects/${project}:getIamPolicy`,{options:{requestedPolicyVersion:3}},hidden());
  if(policy.status!==200)throw Error('Cannot inspect IAM.');
  const grants=(policy.body.bindings||[]).filter(b=>b.members?.includes(member));
  const account=await iam.get(`projects/${project}/serviceAccounts/${member.slice('serviceAccount:'.length)}`,hidden());
  const roleCorrect=account.status===200&&!account.body.disabled&&grants.length===1&&grants[0].role==='roles/datastore.user'&&!grants[0].condition;
  const step4={rulesReleasePresent:release.status===200,rulesMatch,deployedRulesSha256,indexChecks,fieldChecks,exclusiveFirestoreRoleCorrect:roleCorrect};
  console.log(JSON.stringify({step:4,...step4}));
  // Step 5 is strictly read-only, including POST listCollectionIds. Pagination
  // and showMissing detect orphaned subcollections, not just known roots.
  stage='step5-destination-inventory';
  const db=new FirestoreRest(project,'',getAccessToken);
  const documents=await db.inventoryWire();
  const result={checkedAt:new Date().toISOString(),step4,step5:{documents:documents.length,empty:documents.length===0,inventorySha256:hash(JSON.stringify(documents.map(d=>({path:d.path,updateTime:d.updateTime}))))},remoteWrites:0,
    ready:rulesMatch&&indexChecks.every(c=>c.ready)&&fieldChecks.every(c=>c.correct)&&roleCorrect&&documents.length===0};
  await mkdir('work/migration-preparation',{recursive:true});
  await writeFile('work/migration-preparation/remote-readiness.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
  if(!result.ready)process.exitCode=2;
}catch(error){console.error(JSON.stringify({completed:false,stage,diagnostic,httpStatus:error?.status||null,remoteWrites:0}));process.exitCode=1;}
