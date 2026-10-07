import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshCredentialReady } from '../scripts/fresh-credential-readiness.mjs';
import { safeMigrationError } from '../scripts/migration-diagnostics.mjs';
import { inspectPlanUntilFirstWrite } from '../scripts/migration-read-only-plan.mjs';
import { canonicalWire } from '../lib/firestore-remote-migration';
import { digest } from '../lib/security';
import { firestoreBearer } from '../lib/firestore-credentials';
import { generateKeyPair, exportPKCS8 } from 'jose';

const transient=()=>Object.assign(Error('not ready'),{status:400,code:'invalid_grant',reason:'INVALID_JWT_SIGNATURE'});
test('new-key propagation is retried before allowing any task',async()=>{
  let attempts=0;const delays:number[]=[];
  await freshCredentialReady(async()=>{if(++attempts<3)throw transient();return 'secret-token';},{sleep:async(ms:number)=>{delays.push(ms);}});
  assert.equal(attempts,3);assert.deepEqual(delays,[1000,2000]);
});
test('new-key retries are bounded and permanent errors never retry',async()=>{
  let attempts=0;
  await assert.rejects(freshCredentialReady(async()=>{attempts++;throw transient();},{delays:[1,2],sleep:async()=>{}}));
  assert.equal(attempts,3);
  for(const error of [Object.assign(Error('bad'),{status:403,code:'PERMISSION_DENIED'}),Object.assign(Error('bad'),{status:400,code:'invalid_grant',reason:'UNCLASSIFIED_OAUTH_ERROR'})]){
    attempts=0;await assert.rejects(freshCredentialReady(async()=>{attempts++;throw error;},{sleep:async()=>assert.fail('must not retry')}));assert.equal(attempts,1);
  }
});
test('diagnostics retain HTTP codes and frames but never arbitrary exception contents',()=>{
  const e=Object.assign(Error('private-key and personal-data'),{status:400,code:'invalid_grant',reason:'INVALID_JWT_SIGNATURE'});
  const result=safeMigrationError(e);
  assert.equal(result.httpStatus,400);assert.equal(result.code,'invalid_grant');assert.ok(result.frames.length);
  assert.ok(!JSON.stringify(result).includes('private-key'));
});
test('dry plan stops at first write without invoking the real writer',async()=>{
  const plan={version:1,project:'qr-menu-6981a',database:'(default)',runId:'4d27459b-d409-4b16-8d50-c0a6c09f7a92',sourceChecksum:'a'.repeat(64),documents:[{path:'restaurants/example',fields:{name:{stringValue:'Example'}}}]};
  let writes=0;
  const db={isEmulator:false,root:'projects/qr-menu-6981a/databases/(default)/documents',get:async()=>null,inventoryWire:async()=>[],commit:async()=>{writes++;},commitWire:async()=>{writes++;}};
  const result=await inspectPlanUntilFirstWrite(db,plan,await digest(canonicalWire(plan)));
  assert.equal(result.firstWriteReached,true);assert.equal(writes,0);
});
test('OAuth failure preserves only a safe code/reason, then the same provider can recover',async()=>{
  const pair=await generateKeyPair('RS256',{extractable:true});
  const secret=JSON.stringify({project_id:'qr-menu-6981a',client_email:'test@example.invalid',private_key:await exportPKCS8(pair.privateKey)});
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>++calls===1?Response.json({error:'invalid_grant',error_description:'Invalid JWT Signature.',sensitive:'do not print'},{status:400}):Response.json({access_token:'fake-token',expires_in:3600});
  try{
    const bearer=firestoreBearer('qr-menu-6981a',secret);
    await assert.rejects(bearer(),(error:any)=>error.status===400&&error.code==='invalid_grant'&&error.reason==='INVALID_JWT_SIGNATURE'&&!JSON.stringify(error).includes('do not print'));
    assert.equal(await bearer(),'fake-token');assert.equal(await bearer(),'fake-token');assert.equal(calls,2);
  }finally{globalThis.fetch=original;}
});
