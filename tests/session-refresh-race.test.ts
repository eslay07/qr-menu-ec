import test from 'node:test';
import assert from 'node:assert/strict';
import { createD1Fixture } from './d1-fixture';
import { D1DocumentStore } from '../lib/d1-documents';
import { AuthSecurity } from '../lib/auth-security';
import { FirestoreSecurityRepository } from '../lib/firestore-security';
import { handleOwnerDevice } from '../lib/owner-auth';
import type { CentralEnv } from '../lib/central-api';
import type { Store } from '../lib/store';
import { digest } from '../lib/security';
const origin='https://race-auth.test';
const cookie=(value:string)=>value.split(';')[0];
function originalCommit() {
 // Keep the pre-mock implementation and require an explicit receiver for calls.
 return Object.getOwnPropertyDescriptor(D1DocumentStore.prototype, 'commit')!.value as (this: D1DocumentStore, writes: Parameters<D1DocumentStore['commit']>[0]) => ReturnType<D1DocumentStore['commit']>;
}
async function setup(){
 const fixture=createD1Fixture(),rid=crypto.randomUUID(),env={DB:fixture.sql,DATA_PROVIDER:'d1-documents'} as CentralEnv;
 const security=new AuthSecurity(env),first=await security.createSession('owner',rid),device=await security.createDevice(rid,first.sessionHash);
 const other=await security.createSession('owner',rid),otherDevice=await security.createDevice(rid,other.sessionHash);
 const rows=await fixture.db.query('platformConfig/sessionGrants/entries', [{field:'idHash',value:first.sessionHash}]);
 await fixture.db.commit([{path:rows[0].path,data:{idleExpiresAt:new Date(Date.now()-60_000)},mask:['idleExpiresAt'],updateTime:rows[0].updateTime}]);
 const request=()=>new Request(origin+'/api/owner/device-session/refresh',{method:'POST',headers:{cookie:[cookie(first.cookie),cookie(device.cookie)].join('; '),origin,'content-type':'application/json','x-csrf-token':device.csrfToken},body:'{}'});
 const load=()=>({readSession:async()=>({revision:1,state:{restaurantId:rid,access:{active:true}}})}) as unknown as Store;
 return {...fixture,rid,env,security,first,device,other,otherDevice,request,load};
}
for(const action of ['revoke','logout','forget-device'] as const)void test(`renewal cannot resurrect after concurrent ${action} between rotate and bind`,async t=>{
 const f=await setup();const original=originalCommit();let injected=false;
 t.mock.method(D1DocumentStore.prototype,'commit',async function(this:D1DocumentStore,writes:Parameters<D1DocumentStore['commit']>[0]){
  await original.call(this,writes);
  if(!injected && writes.some(w=>w.path.includes('/deviceGrants/')&&w.data?.revokedAt)&&writes.some(w=>w.path.includes('/deviceGrants/')&&w.data?.revokedAt===null)){
   injected=true;
   if(action==='revoke')await f.security.revokeSessionById('owner',f.rid,f.first.sessionHash);
   else if(action==='logout')await f.security.revokeSession(f.request(),'owner');
   else await f.security.revokeDevice(f.request());
  }
 });
 try{
  const response=await handleOwnerDevice(f.request(),f.env,f.load);assert.ok(injected);assert.equal(response.status,401);
  assert.ok(response.headers.getSetCookie().every(value=>value.includes('Max-Age=0')));
  const grants=await f.db.query('platformConfig/sessionGrants/entries');
  const replacements=grants.filter(row=>row.data.idHash!==f.first.sessionHash&&row.data.idHash!==f.other.sessionHash);
  assert.equal(replacements.length,1);assert.ok(replacements[0].data.revokedAt,'unbound created grant must be revoked');
  assert.equal((await f.security.listSessions('owner',f.rid)).length,1);
  assert.ok(await f.security.session(new Request(origin,{headers:{cookie:cookie(f.other.cookie)}}),'owner',f.rid));
  assert.ok(await f.security.device(new Request(origin,{headers:{cookie:cookie(f.otherDevice.cookie)}})));
 }finally{f.sqlite.close();}
});
void test('revocation while bind CAS is pending wins and no orphan remains',async t=>{
 const f=await setup(),original=originalCommit();let injected=false;
 t.mock.method(D1DocumentStore.prototype,'commit',async function(this:D1DocumentStore,writes:Parameters<D1DocumentStore['commit']>[0]){
  if(!injected&&writes.some(w=>w.path.includes('/deviceGrants/')&&w.data?.sessionHash!==f.first.sessionHash&&w.data?.familySessionHash===f.first.sessionHash)){
   injected=true;await f.security.revokeSessionById('owner',f.rid,f.first.sessionHash);
  }
  return original.call(this,writes);
 });
 try{const response=await handleOwnerDevice(f.request(),f.env,f.load);assert.ok(injected);assert.equal(response.status,401);assert.equal((await f.security.listSessions('owner',f.rid)).length,1);}
 finally{f.sqlite.close();}
});
void test('revoking an original session after replacement was linked invalidates the replacement',async t=>{
 const f=await setup(),original=originalCommit();let injected=false;
 t.mock.method(D1DocumentStore.prototype,'commit',async function(this:D1DocumentStore,writes:Parameters<D1DocumentStore['commit']>[0]){
  await original.call(this,writes);
  if(!injected&&writes.some(w=>w.path.includes('/deviceGrants/')&&w.data?.sessionHash!==f.first.sessionHash&&w.data?.familySessionHash===f.first.sessionHash)){
   injected=true;await f.security.revokeSessionById('owner',f.rid,f.first.sessionHash);
  }
 });
 try{const response=await handleOwnerDevice(f.request(),f.env,f.load);assert.ok(injected);assert.equal(response.status,401);assert.equal((await f.security.listSessions('owner',f.rid)).length,1);}
 finally{f.sqlite.close();}
});
void test('concurrent refresh has one winner and cleanup preserves idle-expired family root',async()=>{
 const f=await setup();
 try{
  const responses=await Promise.all([handleOwnerDevice(f.request(),f.env,f.load),handleOwnerDevice(f.request(),f.env,f.load)]);
  assert.deepEqual(responses.map(r=>r.status).sort((a,b)=>a-b),[200,401]);
  const response=responses.find(r=>r.status===200)!;
  const sessionCookie=response.headers.getSetCookie().find(value=>value.startsWith('__Host-qrmenu_owner='))!;
  const deviceCookie=response.headers.getSetCookie().find(value=>value.startsWith('__Host-qrmenu_device='))!;
  const hash=await digest(cookie(sessionCookie).slice('__Host-qrmenu_owner='.length));
  const row=(await f.db.query('platformConfig/sessionGrants/entries',[{field:'idHash',value:hash}]))[0];
  assert.equal(row.data.familySessionHash,f.first.sessionHash);
  await new FirestoreSecurityRepository(f.db).cleanup();
  assert.ok(await f.security.session(new Request(origin,{headers:{cookie:cookie(sessionCookie)}}),'owner',f.rid));
  assert.ok(await f.security.device(new Request(origin,{headers:{cookie:cookie(deviceCookie)}})));
  await f.security.revokeSessionById('owner',f.rid,f.first.sessionHash);
  assert.equal(await f.security.session(new Request(origin,{headers:{cookie:cookie(sessionCookie)}}),'owner',f.rid),null);
  assert.equal(await f.security.device(new Request(origin,{headers:{cookie:cookie(deviceCookie)}})),null);
  assert.ok(await f.security.session(new Request(origin,{headers:{cookie:cookie(f.other.cookie)}}),'owner',f.rid));
 }finally{f.sqlite.close();}
});
