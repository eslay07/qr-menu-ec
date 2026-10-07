import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
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

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync('deployment/cloudflare/d1-documents.sql','utf8'));
  function prepare(sql: string) {
    let values: Array<string | number | null> = [];
    return {
      bind(...input: Array<string | number | null>) { values=input; return this; },
      async first() { return sqlite.prepare(sql).get(...values) || null; },
      async all() { return { results:sqlite.prepare(sql).all(...values) }; },
      async run() { return { success:true, meta:sqlite.prepare(sql).run(...values) }; },
      execute() { return sqlite.prepare(sql).run(...values); },
    };
  }
  const sql = { prepare, async batch(statements: Array<ReturnType<typeof prepare>>) {
    sqlite.exec('BEGIN');
    try { const results=statements.map(statement=>statement.execute()); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  }} as unknown as D1Database;
  return { db:new D1DocumentStore(sql), sql, sqlite };
}

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
  await orders.create(order,'token-test');
  assert.deepEqual(await orders.publicByTokenHash('token-test'),order);
  assert.equal((await orders.list(crypto.randomUUID())).length,0);
  assert.equal(await orders.setStatus(rid,order.id,'cancelled','customer'),true);
  assert.equal(await orders.setStatus(rid,order.id,'cancelled','customer'),false);
  const backup=new FirestoreBackupRepository(db,rid,store), id=await backup.create();
  assert.equal((await backup.read(id)).orders.length,1);
  assert.equal(await backup.restoreComplete(id,1),true);
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
