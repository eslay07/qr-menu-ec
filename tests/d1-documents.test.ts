import { createD1Fixture } from './d1-fixture';
import test from 'node:test';
import assert from 'node:assert/strict';
import { D1DocumentStore } from '../lib/d1-documents';
import { FirestoreError } from '../lib/firestore-rest';
import { FirestoreRestaurantStore } from '../lib/firestore-store';
import { localFirestore } from '../lib/application-repository';
import { blankCatalog, defaultSettings } from '../lib/contracts';
import type { State } from '../lib/store';
import type { OrderRecord } from '../lib/orders';
import { FirestoreOrderStore } from '../lib/firestore-orders';
import { FirestoreBackupRepository } from '../lib/firestore-backups';
import { AuthSecurity } from '../lib/auth-security';
import { RestaurantPreferences } from '../lib/restaurant-preferences';
import { FirestorePush } from '../lib/firestore-push';
import { FcmSender } from '../lib/push-delivery';
import { FirestoreSecurityRepository } from '../lib/firestore-security';

const fixture = createD1Fixture;

test('D1 document provider needs no Google credential and preserves scoped paths and wire types',async()=>{
  const {db,sql,sqlite}=fixture();
  assert.ok(localFirestore({DB:sql,DATA_PROVIDER:'d1-documents'}) instanceof D1DocumentStore);
  await db.commitWire([{path:'restaurants/a',fields:{at:{timestampValue:'2026-10-05T00:00:00Z'},n:{integerValue:'10'}}}]);
  assert.equal((await db.get('restaurants/a'))?.data.n,10);
  assert.deepEqual((await db.getWire('restaurants/a'))?.fields,{at:{timestampValue:'2026-10-05T00:00:00Z'},n:{integerValue:'10'}});
  await assert.rejects(db.get('restaurants/a/private'),/Ruta/);
  await assert.rejects(db.get('restaurants/../private/auth'),/Identificador/);
  assert.equal((await db.list('restaurants/b/orders')).documents.length,0);
  sqlite.close();
});

test('D1 batches rollback all writes on stale revision and duplicate create; masks preserve siblings',async()=>{
  const {db,sqlite}=fixture();
  await db.commit([{path:'restaurants/a',data:{active:true,name:'A'},exists:false}]);
  const original=await db.get('restaurants/a');
  await db.commit([{path:'restaurants/a',data:{name:'New'},mask:['name'],updateTime:original!.updateTime}]);
  assert.deepEqual((await db.get('restaurants/a'))?.data,{active:true,name:'New'});
  await assert.rejects(db.commit([{path:'restaurants/b',data:{name:'B'}},{path:'restaurants/a',data:{name:'stale'},updateTime:original!.updateTime}]),error=>error instanceof FirestoreError && error.conflict);
  assert.equal(await db.get('restaurants/b'),null);
  await assert.rejects(db.commit([{path:'restaurants/a',data:{name:'duplicate'},exists:false}]),error=>error instanceof FirestoreError && error.conflict);
  assert.equal((await db.get('restaurants/a'))?.data.name,'New');
  sqlite.close();
});

test('D1 queries paginate composite cursors, filter dates/booleans and isolate restaurants',async()=>{
  const {db,sqlite}=fixture();
  await db.commit(Array.from({length:5},(_,i)=>({path:`restaurants/a/orders/o${i}`,data:{createdAt:new Date(`2026-10-0${i+1}T00:00:00Z`),demo:false,total:i}})));
  await db.commit([{path:'restaurants/b/orders/secret',data:{createdAt:new Date(),demo:false,total:999}}]);
  const options={orderBy:[{field:'createdAt',direction:'DESCENDING' as const},{field:'__name__',direction:'ASCENDING' as const}]};
  const first=await db.query('restaurants/a/orders',[{field:'demo',value:false}],2,options);
  assert.equal(first[0].data.total,4);
  const next=await db.query('restaurants/a/orders',[{field:'demo',value:false}],2,{...options,startAfter:[{value:first[1].data.createdAt},{reference:first[1].path}]});
  assert.deepEqual(next.map(row=>row.data.total),[2,1]);
  const page=await db.list('restaurants/a/orders',2);
  assert.equal((await db.list('restaurants/a/orders',2,page.nextPageToken)).documents[0].path,'restaurants/a/orders/o2');
  await assert.rejects(db.list('restaurants/b/orders',2,page.nextPageToken),/ámbito/);
  assert.equal((await db.query('restaurants/a/orders',[{field:'createdAt',value:new Date('2026-10-04T00:00:00Z'),op:'GREATER_THAN_OR_EQUAL'}])).length,2);
  await assert.rejects(db.query('restaurants/a/orders',[{field:"x'); DROP TABLE operational_documents; --",value:1}]),/Campo/);
  sqlite.close();
});

test('D1 backup snapshot retries a concurrent mutation and rejects writes through its reader',async()=>{
  const {db,sqlite}=fixture();
  await db.commit([{path:'restaurants/a',data:{n:1}}]);
  let calls=0;
  const result=await db.consistentRead(async reader=>{
    calls++;
    const row=await reader.get('restaurants/a');
    await assert.rejects(reader.commit([{path:'restaurants/b',data:{}}]),/solo lectura/);
    if(calls===1)await db.commit([{path:'restaurants/a',data:{n:2}}]);
    return row!.data.n;
  });
  assert.equal(calls,2); assert.equal(result,2);
  assert.equal(await db.get('restaurants/b'),null);
  sqlite.close();
});

test('D1 inventory includes orphan subcollections and respects excluded document trees',async()=>{
  const {db,sqlite}=fixture();
  await db.commit([{path:'restaurants/a/private/auth',data:{secret:'cipher'}},{path:'platformConfig/creator',data:{enabled:true}}]);
  assert.equal((await db.inventoryWire()).length,2);
  assert.equal((await db.inventoryWire(10,['restaurants/a'])).length,1);
  await assert.rejects(db.inventoryWire(1),/safety/);
  // Repository accepts the shared adapter: no framework or UI replacement.
  const store=new FirestoreRestaurantStore(db,'a',{async mediaGet(){return null;},async mediaPut(){}});
  assert.equal(await store.read(),null);
  sqlite.close();
});

test('D1 supports 150-dish publication, encrypted WiFi, order cancellation and verified restoration',async()=>{
  const {db,sql,sqlite}=fixture(), rid=crypto.randomUUID();
  const security=new AuthSecurity({DB:sql,DATA_PROVIDER:'d1-documents',DATA_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')});
  const state: State={schemaVersion:1,restaurantId:rid,ownerId:`owner:${rid}`,draft:structuredClone(blankCatalog),settings:structuredClone(defaultSettings),published:null,license:null,password:{salt:'',hash:''},recoveryHash:'private',sessionEpoch:1,failures:{count:0,until:0},createdAt:new Date().toISOString(),access:{active:true,features:['orders'],maxDishes:150},security:{firebaseUid:`owner:${rid}`,emailHash:`email-${rid}`,emailCiphertext:'unchanged-cipher'}};
  for(let i=0;i<150;i++)state.draft.dishes.push({id:`dish-${i}`,name:`Plato ${i}`,description:'',categoryId:'principales',priceCents:500,available:true,image:'',modifierGroups:[]});
  const media={async mediaGet(){return null;},async mediaPut(){}};
  const store=new FirestoreRestaurantStore(db,rid,media);
  assert.equal(await store.commit(state,null),true);
  state.published={version:1,at:new Date().toISOString(),catalog:structuredClone(state.draft)};
  assert.equal(await store.commit(state,0),true);
  const preferences=new RestaurantPreferences(db,rid,security);
  const wifi=await preferences.wifi();
  await preferences.saveWifi({enabled:true,name:'Invitados',password:'test-wifi-secret'},wifi.revision);
  assert.ok(!(JSON.stringify(await preferences.wifi()).includes('test-wifi-secret')));
  assert.ok(!(JSON.stringify(await store.readMenu()).includes('test-wifi-secret')));
  assert.equal((await preferences.printWifi())?.text,'WiFi gratis · Clave: test-wifi-secret');
  const orders=new FirestoreOrderStore(db);
  const order:OrderRecord={id:crypto.randomUUID(),restaurantId:rid,number:'PED-TEST',status:'confirmed',demo:false,alias:'Cliente',restaurantName:'Test',menuVersion:1,currency:'USD',totalCents:500,createdAt:new Date().toISOString(),publicExpiresAt:new Date(Date.now()+3600000).toISOString(),cancelledAt:null,lines:[{id:'line-1',dishId:'dish-0',dishName:'Plato 0',quantity:1,basePriceCents:500,unitPriceCents:500,totalCents:500,note:'',options:[]}]};
  const operation={key:crypto.randomUUID(),payloadHash:'backup-operation',token:'backup-token',order};
  await orders.createOnce(order,'token-test',operation);
  assert.deepEqual(await orders.publicByTokenHash('token-test'),order);
  assert.equal((await orders.list(crypto.randomUUID())).length,0);
  assert.equal(await orders.setStatus(rid,order.id,'cancelled','customer'),true);
  assert.equal(await orders.setStatus(rid,order.id,'cancelled','customer'),false);
  const backup=new FirestoreBackupRepository(db,rid,store), id=await backup.create();
  assert.equal((await backup.read(id)).orders.length,1);
  assert.equal((await backup.read(id)).orderOperations.length,1);
  await db.commit([{path:`restaurants/${rid}/orderOperations/${operation.key}`,delete:true}]);
  assert.equal(await backup.restoreComplete(id,1),true);
  assert.equal((await orders.operation(rid,operation.key))?.order.id,order.id);
  assert.equal((await store.read())?.state.draft.dishes.length,150);
  assert.equal((await store.read())?.state.security?.emailCiphertext,'unchanged-cipher');
  assert.equal((await orders.read(rid,order.id))?.status,'cancelled');
  sqlite.close();
});

test('D1 preserves remembered grants, creator challenges and atomic rate limits',async()=>{
  const {db,sql,sqlite}=fixture(),rid=crypto.randomUUID();
  const security=new AuthSecurity({DB:sql,DATA_PROVIDER:'d1-documents'});
  const session=await security.createSession('owner',rid);
  const request=new Request('https://example.test/api',{headers:{Cookie:session.cookie.split(';')[0],Origin:'https://example.test','x-csrf-token':session.csrfToken}});
  assert.ok(await security.session(request,'owner',rid));
  assert.equal(await security.session(request,'owner',crypto.randomUUID()),null);
  const device=await security.createDevice(rid);
  const remembered=new Request('https://example.test/api',{headers:{Cookie:device.cookie.split(';')[0],Origin:'https://example.test'}});
  assert.equal((await security.device(remembered))?.restaurant_id,rid);
  const rotated=await Promise.all([security.rotateDevice(remembered,device.csrfToken),security.rotateDevice(remembered,device.csrfToken)]);
  assert.equal(rotated.filter(Boolean).length,1);
  assert.equal(await security.device(remembered),null);
  const challenge=await security.challenge('creator',null,'mfa_login',{totp:'cipher'});
  const pending=await security.readChallenge(new Request('https://example.test',{headers:{Cookie:challenge.cookie.split(';')[0]}}),'creator',null);
  assert.ok(pending);
  const used=await Promise.allSettled([security.consumeChallenge(pending.hash),security.consumeChallenge(pending.hash)]);
  assert.equal(used.filter(result=>result.status==='fulfilled').length,1);
  const repo=new FirestoreSecurityRepository(db);
  const limits=await Promise.all(Array.from({length:10},()=>repo.consumeLimit('device-test','test',5,60000)));
  assert.equal(limits.filter(result=>result.allowed).length,5);
  await security.revokeSubject('owner',rid);
  assert.equal(await security.session(request,'owner',rid),null);
  sqlite.close();
});

test('D1 push delivers through FCM contract, preferences gate delivery, tokens stay encrypted',async()=>{
  const {db,sql,sqlite}=fixture(),rid=crypto.randomUUID();
  const security=new AuthSecurity({DB:sql,DATA_PROVIDER:'d1-documents',DATA_ENCRYPTION_KEY:Buffer.alloc(32,8).toString('base64')});
  await db.commit([{path:`restaurants/${rid}`,data:{access:{active:true}}},{path:`restaurants/${rid}/private/auth`,data:{sessionEpoch:1}}]);
  const push=new FirestorePush(db,rid,security),token='fake-test-token-not-a-real-phone';
  await push.register({token,platform:'android'},1,'test-session');
  assert.ok(!JSON.stringify((await db.list(`restaurants/${rid}/pushDevices`)).documents).includes(token));
  let sends=0;
  const sender=new FcmSender('demo-qr-menu-ec',async()=>'test',async()=>{sends++;return Response.json({name:'test'});});
  const now=new Date(Date.now()+2000);
  await db.commit([{path:`restaurants/${rid}/pushJobs/test`,data:{eventId:'test',preference:'newOrder',createdAt:now,expiresAt:new Date(now.getTime()+3600000),nextAttemptAt:now,attempt:0,delivered:[]}}]);
  await push.dispatch(sender,now);
  assert.equal(sends,1); assert.equal(await db.get(`restaurants/${rid}/pushJobs/test`),null);
  await db.commit([{path:`restaurants/${rid}/settings/notifications`,data:{newOrder:false}},{path:`restaurants/${rid}/pushJobs/disabled`,data:{eventId:'disabled',preference:'newOrder',createdAt:now,expiresAt:new Date(now.getTime()+3600000),nextAttemptAt:now,attempt:0,delivered:[]}}]);
  await push.dispatch(sender,now); assert.equal(sends,1);
  sqlite.close();
});

test('D1 atomic operation identity accepts concurrent retry once and rejects changed payload',async()=>{
 const {db,sqlite}=fixture(),rid=crypto.randomUUID(),orders=new FirestoreOrderStore(db);
 const order:OrderRecord={id:crypto.randomUUID(),restaurantId:rid,number:'IDEMPOTENT',status:'confirmed',demo:true,alias:'Ensayo',restaurantName:'Ficticio',menuVersion:1,currency:'USD',totalCents:500,createdAt:new Date().toISOString(),publicExpiresAt:new Date(Date.now()+3600000).toISOString(),cancelledAt:null,lines:[{id:'line',dishId:'dish',dishName:'Ensayo',quantity:1,basePriceCents:500,unitPriceCents:500,totalCents:500,note:'',options:[]}]};
 const operation={key:crypto.randomUUID(),payloadHash:'same',token:'token-a',order};
 const results=await Promise.all([orders.createOnce(order,'hash-a',operation),orders.createOnce({...order,id:crypto.randomUUID()},'hash-b',{...operation,token:'token-b',order:{...order,id:crypto.randomUUID()}})]);
 assert.equal(results[0].order.id,results[1].order.id);assert.equal((await db.all(`restaurants/${rid}/orders`)).length,1);
 await assert.rejects(orders.createOnce({...order,id:crypto.randomUUID()},'hash-c',{...operation,payloadHash:'different'}),/otro pedido/);
 const second={...order,id:crypto.randomUUID()};await orders.createOnce(second,'hash-d',{...operation,key:crypto.randomUUID(),order:second});assert.equal((await db.all(`restaurants/${rid}/orders`)).length,2);
 sqlite.close();
});
test('D1 individual session revocation prevents its remembered device from returning and leaves another intact',async()=>{
 const {sql,sqlite}=fixture(),rid=crypto.randomUUID(),security=new AuthSecurity({DB:sql,DATA_PROVIDER:'d1-documents'});
 const first=await security.createSession('owner',rid),second=await security.createSession('owner',rid);
 const a=await security.createDevice(rid,first.sessionHash),b=await security.createDevice(rid,second.sessionHash);
 const request=(cookie:string)=>new Request('https://example.test',{headers:{cookie:cookie.split(';')[0]}});
 await security.revokeSessionById('owner',rid,first.sessionHash);
 assert.equal(await security.device(request(a.cookie)),null);assert.ok(await security.device(request(b.cookie)));assert.ok(await security.session(request(second.cookie),'owner',rid));sqlite.close();
});

test('D1 readable public aliases reserve atomically and retain canonical address after rename',async()=>{
 const {sql,sqlite}=fixture();const {DomainService}=await import('../lib/domains');const domains=new DomainService({DB:sql,DATA_PROVIDER:'d1-documents'});
 const a=crypto.randomUUID(),b=crypto.randomUUID();const urls=await Promise.all([domains.reservePublicPath(a,'Ñaña café!','https://menus.test'),domains.reservePublicPath(b,'Ñaña café!','https://menus.test')]);
 assert.deepEqual(new Set(urls),new Set(['https://menus.test/m/nana-cafe','https://menus.test/m/nana-cafe-2']));assert.equal(await domains.reservePublicPath(a,'Cambio nombre','https://menus.test'),urls[0]);sqlite.close();
});

test('ten owner reopen refreshes reuse a valid session and preserve the other device',async()=>{
 const {sql,sqlite}=fixture(),rid=crypto.randomUUID(),env={DB:sql,DATA_PROVIDER:'d1-documents' as const},security=new AuthSecurity(env);
 const first=await security.createSession('owner',rid),second=await security.createSession('owner',rid),device=await security.createDevice(rid,first.sessionHash);
 const {handleOwnerDevice}=await import('../lib/owner-auth');
 const request=()=>new Request('https://example.test/api/owner/device-session/refresh',{method:'POST',headers:{cookie:[first.cookie.split(';')[0],device.cookie.split(';')[0]].join('; '),origin:'https://example.test','content-type':'application/json','x-csrf-token':device.csrfToken},body:'{}'});
 const load=()=>({readSession:async()=>({revision:1,state:{restaurantId:rid,access:{active:true}}})}) as never;
 for(let i=0;i<10;i++)assert.equal((await handleOwnerDevice(request(),env as never,load)).status,200);
 assert.equal((await security.listSessions('owner',rid)).length,2);
 await security.revokeSessionById('owner',rid,first.sessionHash);assert.equal((await handleOwnerDevice(request(),env as never,load)).status,401);
 assert.ok(await security.session(new Request('https://example.test',{headers:{cookie:second.cookie.split(';')[0]}}),'owner',rid));sqlite.close();
});

test('workers.dev provisioning reserves ownership before upload and never overwrites an existing Worker',async()=>{
 const {db,sql,sqlite}=fixture(),{DomainService}=await import('../lib/domains'),rid=crypto.randomUUID();
 const domains=new DomainService({DB:sql,DATA_PROVIDER:'d1-documents',CLOUDFLARE_ACCOUNT_ID:'test-account',CLOUDFLARE_API_TOKEN:'fictitious-token',CLOUDFLARE_WORKERS_SUBDOMAIN:'testing'});
 const original=globalThis.fetch,uploads:string[]=[];
 globalThis.fetch=async(url,init)=>{
   const service=String(url).split('/').at(-1)!;
   if(!init?.method || init.method==='GET')return new Response(service==='mesa'?'{"success":true}':'{"success":false}',{status:service==='mesa'?200:404});
   assert.equal(init.method,'PUT');assert.equal(service,'mesa-2');
   const reserved=await db.get(`hostnames/${service}.testing.workers.dev`);assert.equal(reserved?.data.restaurantId,rid);assert.equal(reserved?.data.status,'provisioning');uploads.push(service);return Response.json({success:true});
 };
 try {assert.equal(await domains.provisionFree(rid,'Mesa','https://example.test'),'https://mesa-2.testing.workers.dev/menu');assert.deepEqual(uploads,['mesa-2']);assert.equal((await db.get('hostnames/mesa-2.testing.workers.dev'))?.data.status,'active');}
 finally{globalThis.fetch=original;sqlite.close();}
});
