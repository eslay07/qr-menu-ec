import { test } from 'node:test';
import assert from 'node:assert/strict';
import maintenance from '../deployment/cloudflare/maintenance-only';
import { withMigrationCredential, migrationIdentity, migrationProject } from '../scripts/migration-credential.mjs';
import { awaitMaintenance } from '../scripts/maintenance-convergence.mjs';

test('edge propagation requires three consecutive complete rounds; 302 never passes',async()=>{
  let clock=0,calls=0;
  const good={status:503,marker:'write-freeze-v1',build:'d1-freeze-v2'};
  const attempts=await awaitMaintenance(async()=>[++calls<3?{status:302}:good],{now:()=>clock,sleep:async()=>{clock+=1000;},timeoutMs:10000});
  assert.equal(attempts.length,5);
  assert.equal(attempts[0].passed,false);
  await assert.rejects(awaitMaintenance(async()=>[{status:302}],{now:()=>clock,sleep:async()=>{clock+=1000;},timeoutMs:2000}));
});

test('maintenance-only version blocks every route without bindings or secrets',async()=>{
  for(const origin of ['https://qr-menu-ec.consola.workers.dev','https://la-sazon-marinera.consola.workers.dev'])
    for(const path of ['/','/owner','/creator','/api/owner/login','/api/owner/device','/api/v1/orders','/r/998d4980-a169-469f-b009-634a373ca7ad/','/assets/app.js'])
      for(const method of ['GET','POST','PUT','DELETE','OPTIONS','HEAD']) {
        const response=await maintenance.fetch(new Request(origin+path,{method}));
        assert.equal(response.status,503);
        assert.equal(response.headers.get('X-QRMenu-Maintenance'),'write-freeze-v1');
        assert.equal(response.headers.get('Set-Cookie'),null);
        assert.equal(response.headers.get('Cache-Control'),'no-store');
      }
  await maintenance.scheduled();
});

for(const fail of [false,true])test(`temporary credential is revoked after ${fail?'interruption':'success'}`,async()=>{
  const calls:string[]=[];const records:unknown[]=[];
  const keyName=`projects/${migrationProject}/serviceAccounts/${migrationIdentity}/keys/test-only`;
  const iam={check:async()=>{calls.push('check');},create:async()=>({name:keyName,privateKeyData:Buffer.from(JSON.stringify({project_id:migrationProject,client_email:migrationIdentity,private_key:'test-only-secret'})).toString('base64')}),remove:async(name:string)=>{assert.equal(name,keyName);calls.push('revoked');}};
  const run=withMigrationCredential(iam,async(bearer:()=>Promise<string>)=>{assert.equal(await bearer(),'test-only-token');if(fail)throw Error('interrupted');return 'ok';},async(r:unknown)=>{records.push(r);},()=>async()=> 'test-only-token');
  if(fail)await assert.rejects(run,/interrupted/);else assert.equal(await run,'ok');
  assert.deepEqual(calls,['check','revoked']);
  assert.ok(!JSON.stringify(records).includes('test-only-secret'));
  assert.ok(!JSON.stringify(records).includes('test-only-token'));
});

test('permission failure never creates a credential',async()=>{
  await assert.rejects(withMigrationCredential({check:async()=>{throw Error('denied');},create:async()=>{assert.fail('must not create');}},async()=>{},async()=>{}),/denied/);
});
