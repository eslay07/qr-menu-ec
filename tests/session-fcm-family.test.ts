import test from 'node:test';
import assert from 'node:assert/strict';
import { createD1Fixture } from './d1-fixture';
import { AuthSecurity } from '../lib/auth-security';
import { FirestorePush, pushJob } from '../lib/firestore-push';
import { firestoreHashId } from '../lib/firestore-rest';
import { FcmSender } from '../lib/push-delivery';
const origin='https://fcm-family.test';
const cookie=(v:string)=>v.split(';')[0];
async function setup(){
 const f=createD1Fixture(),rid=crypto.randomUUID(),security=new AuthSecurity({DB:f.sql,DATA_PROVIDER:'d1-documents',DATA_ENCRYPTION_KEY:Buffer.alloc(32,5).toString('base64')});
 await f.db.commit([{path:`restaurants/${rid}`,data:{access:{active:true}}},{path:`restaurants/${rid}/private/auth`,data:{sessionEpoch:1}}]);
 const root=await security.createSession('owner',rid),device=await security.createDevice(rid,root.sessionHash);
 const rotated=await security.rotateDevice(new Request(origin,{headers:{origin,cookie:cookie(device.cookie)}}),device.csrfToken);assert.ok(rotated);
 const child=await security.createSession('owner',rid);assert.equal(await security.bindDeviceSession(new Request(origin,{headers:{cookie:cookie(rotated.cookie)}}),child.sessionHash),true);
 const other=await security.createSession('owner',rid),push=new FirestorePush(f.db,rid,security);
 const childToken='fictitious-child-fcm-token-not-real',otherToken='fictitious-other-fcm-token-not-real';
 const childPush=await push.register({token:childToken,platform:'android'},1,child.csrfToken);
 await push.register({token:otherToken,platform:'web'},1,other.csrfToken);
 const revokeRoot=async()=>{const path='platformConfig/sessionGrants/entries/'+firestoreHashId(root.sessionHash);const row=await f.db.get(path);assert.ok(row);await f.db.commit([{path,data:{revokedAt:new Date()},mask:['revokedAt'],updateTime:row.updateTime}]);};
 return {...f,rid,security,root,child,other,push,childToken,otherToken,childPush,revokeRoot};
}
for(const legacy of [false,true])test(`FCM delivery checks revoked original family for ${legacy?'legacy':'new'} child binding without relying on token deletion`,async()=>{
 const f=await setup();
 try{
  if(legacy){const path=`restaurants/${f.rid}/pushDevices/${f.childPush.id}`;const row=await f.db.get(path);await f.db.commit([{path,data:{},mask:['sessionGrantHash','sessionFamilyHash'],updateTime:row!.updateTime}]);}
  await f.revokeRoot();
  assert.ok(await f.db.get(`restaurants/${f.rid}/pushDevices/${f.childPush.id}`),'token is deliberately left behind to test delivery authorization');
  const now=new Date(Date.now()+1000);await f.db.commit([pushJob(f.rid,'family-revoked','newOrder',now)]);
  const tokens:string[]=[];const sender=new FcmSender('demo-qr-menu-ec',async()=>'fictitious',async(_url,init)=>{tokens.push(JSON.parse(String(init?.body)).message.token);return Response.json({name:'fictitious-message'});});
  await f.push.dispatch(sender,now);
  assert.deepEqual(tokens,[f.otherToken]);assert.equal(await f.db.get(`restaurants/${f.rid}/pushDevices/${f.childPush.id}`),null);
 }finally{f.sqlite.close();}
});
test('FCM rechecks family revoked after queue snapshot and before send',async t=>{
 const f=await setup();let injected=false;const original=f.db.get.bind(f.db);
 t.mock.method(f.db,'get',async(path:string)=>{if(!injected&&path===`restaurants/${f.rid}/pushDevices/${f.childPush.id}`){injected=true;await f.revokeRoot();}return original(path);});
 try{
  const now=new Date(Date.now()+1000);await f.db.commit([pushJob(f.rid,'race-revoked','newOrder',now)]);
  const tokens:string[]=[];const sender=new FcmSender('demo-qr-menu-ec',async()=>'fictitious',async(_url,init)=>{tokens.push(JSON.parse(String(init?.body)).message.token);return Response.json({name:'fictitious-message'});});
  await f.push.dispatch(sender,now);assert.ok(injected);assert.deepEqual(tokens,[f.otherToken]);
 }finally{f.sqlite.close();}
});
test('FCM registration rejects missing and revoked grants instead of accepting generic bindings',async()=>{
 const f=await setup();
 try{await assert.rejects(f.push.register({token:'fictitious-unbound-fcm-token',platform:'web'},1,'missing-csrf'));await f.revokeRoot();await assert.rejects(f.push.register({token:'fictitious-revoked-fcm-token',platform:'web'},1,f.child.csrfToken));}
 finally{f.sqlite.close();}
});

test('background FCM survives idle cleanup without making idle-expired cookies valid',async()=>{
 const f=await setup();
 try{
  for(const hash of [f.root.sessionHash,f.child.sessionHash]){const path='platformConfig/sessionGrants/entries/'+firestoreHashId(hash);const row=await f.db.get(path);await f.db.commit([{path,data:{idleExpiresAt:new Date(Date.now()-60_000)},mask:['idleExpiresAt'],updateTime:row!.updateTime}]);}
  const {FirestoreSecurityRepository}=await import('../lib/firestore-security');await new FirestoreSecurityRepository(f.db).cleanup();
  assert.equal(await f.security.session(new Request(origin,{headers:{cookie:cookie(f.child.cookie)}}),'owner',f.rid),null);
  const now=new Date(Date.now()+1000);await f.db.commit([pushJob(f.rid,'background-active','newOrder',now)]);
  const tokens:string[]=[];const sender=new FcmSender('demo-qr-menu-ec',async()=>'fictitious',async(_url,init)=>{tokens.push(JSON.parse(String(init?.body)).message.token);return Response.json({name:'fictitious-message'});});
  await f.push.dispatch(sender,now);assert.deepEqual(new Set(tokens),new Set([f.childToken,f.otherToken]));
 }finally{f.sqlite.close();}
});
