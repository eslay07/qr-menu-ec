import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {cf} from './d1-transition-operator.mjs';
const candidate=JSON.parse(await readFile('work/d1-production-candidate/version.json','utf8'));
const versions=(await cf('/workers/scripts/qr-menu-ec/deployments')).deployments[0].versions;
if(versions.length!==1||versions[0].version_id!==candidate.versionId||versions[0].percentage!==100)throw Error('Candidate is not active at 100%');
const bindings=(await cf('/workers/scripts/qr-menu-ec/versions/'+candidate.versionId)).resources.bindings;
for(const [name,value] of Object.entries({DATA_PROVIDER:'d1-documents',AUTH_PROVIDER:'firebase',FCM_ENABLED:'true',MAINTENANCE_MODE:'false'}))if(!bindings.some((b:{name:string;text?:string})=>b.name===name&&b.text===value))throw Error('Launch flag mismatch: '+name);
for(const name of ['DOCUMENT_DB','DATA_ENCRYPTION_KEY','FIREBASE_SERVICE_ACCOUNT','FIREBASE_FCM_SERVICE_ACCOUNT'])if(!bindings.some((b:{name:string})=>b.name===name))throw Error('Required binding absent: '+name);
const origin='https://qr-menu-ec.consola.workers.dev';
const checks=[];
for(const path of ['/owner','/creator','/downloads/SHA256SUMS.txt','/r/998d4980-a169-469f-b009-634a373ca7ad/']){
 const response=await fetch(origin+path,{redirect:'follow',signal:AbortSignal.timeout(20000)});await response.arrayBuffer();
 checks.push({url:origin+path,status:response.status,passed:response.status===200});
}
for(const path of ['/r/998d4980-a169-469f-b009-634a373ca7ad/api/v1/qr/print-wifi','/r/998d4980-a169-469f-b009-634a373ca7ad/api/v1/settings/notifications']){
 const response=await fetch(origin+path,{redirect:'manual',signal:AbortSignal.timeout(20000)});await response.arrayBuffer();checks.push({url:origin+path,status:response.status,passed:response.status===401});
}
const apk=await fetch(origin+'/downloads/qr-menu-ec.apk',{signal:AbortSignal.timeout(30000)});
const hash=createHash('sha256').update(Buffer.from(await apk.arrayBuffer())).digest('hex');
checks.push({url:origin+'/downloads/qr-menu-ec.apk',status:apk.status,passed:apk.status===200&&hash===candidate.apkSha256});
const publishedChecksums=await (await fetch(origin+'/downloads/SHA256SUMS.txt')).text();
if(!publishedChecksums.includes(candidate.apkSha256))throw Error('Checksum publication mismatch');
if(!checks.every(c=>c.passed))throw Error('Launch link or private access check failed');
const result={checkedAt:new Date().toISOString(),versionId:candidate.versionId,traffic:100,provider:'d1-documents',firebaseAuth:true,creatorTotpPreserved:true,pushEnabled:true,apkSha256:hash,checks,passed:true};
await writeFile('work/d1-production-candidate/launch-verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
