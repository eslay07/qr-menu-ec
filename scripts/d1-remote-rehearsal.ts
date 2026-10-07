import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {D1DocumentStore} from '../lib/d1-documents';
import {FirestoreRestaurantStore} from '../lib/firestore-store';
import {FirestoreOrderStore} from '../lib/firestore-orders';
import {FirestoreBackupRepository} from '../lib/firestore-backups';
import {blankCatalog,defaultSettings} from '../lib/contracts';
import type {State} from '../lib/store';
import {FirestoreError} from '../lib/firestore-rest';
import {remoteD1,unchangedProduction} from './d1-transition-operator.mjs';

if(!process.argv.includes('--isolated-test-data-only'))throw Error('Explicit isolated test mode required.');
const destination=JSON.parse(await readFile('work/d1-transition/destination.json','utf8'));
if(destination.databaseId!=='0c8dab0c-5e79-4272-a28c-90b00a93e676')throw Error('Unexpected isolated destination.');
await unchangedProduction();
const db=new D1DocumentStore(remoteD1(destination.databaseId) as unknown as D1Database);
if((await db.inventoryWire()).length)throw Error('Destination not empty; cannot run synthetic rehearsal.');
const id=crypto.randomUUID(),checks:string[]=[];
const state:State={schemaVersion:1,restaurantId:id,ownerId:'qa-owner',draft:structuredClone(blankCatalog),settings:structuredClone(defaultSettings),published:null,license:null,password:{salt:'',hash:''},recoveryHash:'test-only',sessionEpoch:1,failures:{count:0,until:0},createdAt:new Date().toISOString(),access:{active:true,features:['orders'],maxDishes:150}};
const store=new FirestoreRestaurantStore(db,id,{async mediaGet(){return null;},async mediaPut(){}});
for(let i=0;i<150;i++)state.draft.dishes.push({id:`dish-${i}`,name:`Plato ${i}`,description:'',categoryId:'principales',priceCents:500,available:true,image:'',modifierGroups:[]});
try{
 assert.equal(await store.commit(state,null),true);checks.push('150 dishes create');
 state.published={version:1,at:new Date().toISOString(),catalog:structuredClone(state.draft)};
 assert.equal(await store.commit(state,0),true);checks.push('150 dishes publish');
 assert.equal((await store.readMenu())?.state.published?.catalog.dishes.length,150);checks.push('public menu reads');
 const old=await db.get(`restaurants/${id}`);
 await assert.rejects(db.commit([{path:`restaurants/${id}/private/rollback`,data:{test:true}},{path:old!.path,data:{},updateTime:'stale'}]),error=>error instanceof FirestoreError&&error.conflict);
 assert.equal(await db.get(`restaurants/${id}/private/rollback`),null);checks.push('remote atomic rollback');
 const orders=new FirestoreOrderStore(db);
 const orderId=crypto.randomUUID();
 await orders.create({id:orderId,restaurantId:id,number:'QA-ONLY',status:'confirmed',demo:false,alias:'Prueba aislada',restaurantName:'Prueba',menuVersion:1,currency:'USD',totalCents:500,createdAt:new Date().toISOString(),publicExpiresAt:new Date(Date.now()+3600000).toISOString(),cancelledAt:null,lines:[{id:'line-1',dishId:'dish-0',dishName:'Plato 0',quantity:1,basePriceCents:500,unitPriceCents:500,totalCents:500,note:'',options:[]}]},`qa-${id}`);
 assert.equal(await orders.setStatus(id,orderId,'cancelled','customer'),true);checks.push('order and cancellation');
 const backups=new FirestoreBackupRepository(db,id,store),backup=await backups.create();
 assert.equal((await backups.read(backup)).orders.length,1);
 assert.equal(await backups.restoreComplete(backup,1),true);checks.push('verified backup and restore');
 await unchangedProduction();
}finally{
 const rows=await db.inventoryWire();
 const allowed=(path:string)=>path.startsWith(`restaurants/${id}/`)||path===`restaurants/${id}`||path.startsWith(`publicMenus/${id}/`)||path===`publicMenus/${id}`||path===`platformConfig/orderTokens/entries/qa-${id}`;
 if(rows.some(row=>!allowed(row.path)))throw Error('Unexpected document found; refusing cleanup.');
 for(let i=0;i<rows.length;i+=40)await db.commit(rows.slice(i,i+40).map(row=>({path:row.path,delete:true,updateTime:row.updateTime})));
 assert.equal((await db.inventoryWire()).length,0);
}
const receipt={checkedAt:new Date().toISOString(),databaseId:destination.databaseId,checks,passed:true,destinationEmpty:true,realCustomerDataUsed:false,productionUnchanged:true};
await writeFile('work/d1-transition/remote-rehearsal.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt,null,2));
