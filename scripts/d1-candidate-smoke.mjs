import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {cf,unchangedProduction} from './d1-transition-operator.mjs';
const receipt=JSON.parse(await readFile('work/d1-production-candidate/version.json','utf8'));
await unchangedProduction();
const version=await cf(`/workers/scripts/qr-menu-ec/versions/${receipt.versionId}`);
assert.ok(version.resources.bindings.some(b=>b.name==='DATA_PROVIDER'&&b.text==='d1-documents'));
assert.ok(version.resources.bindings.some(b=>b.name==='FCM_ENABLED'&&b.text==='true'));
const origin=`https://${receipt.versionId.slice(0,8)}-qr-menu-ec.consola.workers.dev`,checks=[];
async function probe(path,status){
 const response=await fetch(origin+path,{redirect:'manual',signal:AbortSignal.timeout(30000)});
 checks.push({path,status:response.status,passed:response.status===status});
 assert.equal(response.status,status,path);return response;
}
const creator=await (await probe('/api/creator/session',200)).json();
assert.equal(creator.authProvider,'firebase');assert.equal(creator.mfaConfigured,true);
const base='/r/998d4980-a169-469f-b009-634a373ca7ad';
const menu=await (await probe(base+'/api/v1/menu',200)).json();
assert.equal(menu.restaurantId,'998d4980-a169-469f-b009-634a373ca7ad');
assert.ok(menu.catalog);
assert.ok(!/wifiCiphertext|wifiPassword|wifiPassphrase/.test(JSON.stringify(menu)));
for(const route of ['settings/notifications','settings/wifi','qr/print-wifi','state'])await probe(base+'/api/v1/'+route,401);
const alias=await probe(base+'/menu',302);
assert.equal(alias.headers.get('location'),'https://la-sazon-marinera.consola.workers.dev/menu');
await unchangedProduction();
const result={checkedAt:new Date().toISOString(),versionId:receipt.versionId,checks,passed:true,productionUnchanged:true,explicitWrites:0,notes:['Session GET may append a private audit event. Alias was not followed. Authenticated and physical acceptance are separate.']};
await writeFile('work/d1-production-candidate/smoke.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
