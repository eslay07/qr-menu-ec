import test from 'node:test';
import assert from 'node:assert/strict';
import { createD1Fixture } from './d1-fixture';
import { AuthSecurity } from '../lib/auth-security';
import { FirestorePush, pushJob } from '../lib/firestore-push';
import { handleApi } from '../lib/api';
import { blankCatalog } from '../lib/contracts';
import { digest } from '../lib/security';
import type { State, Store } from '../lib/store';
import type { FcmSender } from '../lib/push-delivery';
const origin='https://fcm-revoke.test';
const token=(cookie:string)=>cookie.split(';')[0].split('=')[1];
for(const action of ['session','device','logout'] as const)void test(`API ${action} revokes all renewed family FCM tokens while preserving another device`,async()=>{
 const {db,sql,sqlite}=createD1Fixture(),rid=crypto.randomUUID();
 const security=new AuthSecurity({DB:sql,DATA_PROVIDER:'d1-documents',DATA_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')});
 const push=new FirestorePush(db,rid,security),first=await security.createSession('owner',rid),device=await security.createDevice(rid,first.sessionHash),other=await security.createSession('owner',rid),otherDevice=await security.createDevice(rid,other.sessionHash);
 const rotated=await security.rotateDevice(new Request(origin,{headers:{cookie:device.cookie.split(';')[0],origin}}),device.csrfToken);assert.ok(rotated);
 const renewed=await security.createSession('owner',rid);assert.equal(await security.bindDeviceSession(new Request(origin,{headers:{cookie:rotated.cookie.split(';')[0]}}),renewed.sessionHash),true);
 const state:State={schemaVersion:1,restaurantId:rid,ownerId:'owner:'+rid,draft:structuredClone(blankCatalog),settings:{webUrl:'',ordersEnabled:true},published:null,license:null,password:{salt:'',hash:''},recoveryHash:'',sessionEpoch:1,failures:{count:0,until:0},createdAt:new Date().toISOString(),access:{active:true,plan:'premium',features:['orders'],maxDishes:40}};
 await db.commit([{path:'restaurants/'+rid,data:{access:state.access},exists:false},{path:'restaurants/'+rid+'/private/auth',data:{sessionEpoch:1},exists:false}]);
 const store:Store={async read(){return {revision:1,state};},async commit(){throw Error('Revocation must not change menu');},async mediaGet(){return null;},async mediaPut(){}};
 await push.register({token:'FICTITIOUS_renewed_token_1234567890',platform:'web'},1,renewed.csrfToken);await push.register({token:'FICTITIOUS_other_token_1234567890',platform:'web'},1,other.csrfToken);
 const closing=action==='logout'?renewed:other;const cookies=[closing.cookie.split(';')[0],...(action==='logout'?[rotated.cookie.split(';')[0]]:[])].join('; ');
 const path=action==='session'?'sessions/'+encodeURIComponent(first.sessionHash):action==='device'?'devices/'+encodeURIComponent(await digest(token(device.cookie))):'logout';
 try{
  const response=await handleApi(new Request(origin+'/api/v1/'+path,{method:action==='logout'?'POST':'DELETE',headers:{cookie:cookies,origin,'content-type':'application/json','x-csrf-token':closing.csrfToken},...(action==='logout'?{body:'{}'}:{})}),store,{publicKey:'',setupToken:'',runtime:'cloud',security,push,ownerAccess:true,grantedFeatures:['orders']});assert.equal(response.status,200);
  const devices=await db.all('restaurants/'+rid+'/pushDevices');assert.equal(devices.length,1);assert.equal(devices[0].data.sessionBinding,await digest(other.csrfToken));
  const now=new Date(Date.now()+100);await db.commit([pushJob(rid,'test-revocation','newOrder',now)]);
  const sent:string[]=[];await push.dispatch({send:async(value:{token:string})=>{sent.push(value.token);return 'sent';}} as unknown as FcmSender,now);
  assert.deepEqual(sent,['FICTITIOUS_other_token_1234567890']);assert.ok(await security.device(new Request(origin,{headers:{cookie:otherDevice.cookie.split(';')[0]}})));
 }finally{sqlite.close();}
});
