import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1Fixture } from './d1-fixture';
import { D1OrderStore, type OrderRecord } from '../lib/orders';
void test('legacy migration 0006 and D1 operation batches preserve retry identity, conflict and independent purchases',async()=>{
 const {sql,sqlite}=createD1Fixture();sqlite.exec(readFileSync('drizzle/0002_orders_and_hosts.sql','utf8'));sqlite.exec(readFileSync('drizzle/0006_order_operations.sql','utf8'));sqlite.exec(readFileSync('drizzle/0006_order_operations.sql','utf8'));
 const store=new D1OrderStore(sql),rid=crypto.randomUUID();
 const order:OrderRecord={id:crypto.randomUUID(),restaurantId:rid,number:'FICTICIO',status:'confirmed',demo:false,alias:'Ensayo',restaurantName:'Prueba legacy',menuVersion:1,currency:'USD',totalCents:500,createdAt:new Date().toISOString(),publicExpiresAt:new Date(Date.now()+3600000).toISOString(),cancelledAt:null,lines:[{id:'line',dishId:'dish',dishName:'Plato',quantity:1,basePriceCents:500,unitPriceCents:500,totalCents:500,note:'',options:[]}]};
 const operation={key:crypto.randomUUID(),payloadHash:'same-payload',token:'legacy-a',order};
 try{
  const retry={...order,id:crypto.randomUUID()};const outcomes=await Promise.all([store.createOnce(order,'hash-a',operation),store.createOnce(retry,'hash-b',{...operation,token:'legacy-b',order:retry})]);
  assert.equal(outcomes[0].order.id,outcomes[1].order.id);assert.equal((await store.list(rid)).length,1);assert.equal((await store.operation(rid,operation.key))?.token,'legacy-a');assert.equal(await store.publicByTokenHash('hash-b'),null);
  const changed={...order,id:crypto.randomUUID()};await assert.rejects(store.createOnce(changed,'hash-c',{...operation,payloadHash:'changed',order:changed}),/otro pedido/);assert.equal((await store.list(rid)).length,1);
  const second={...order,id:crypto.randomUUID()};await store.createOnce(second,'hash-d',{...operation,key:crypto.randomUUID(),order:second});assert.equal((await store.list(rid)).length,2);
  const differentRestaurant={...order,id:crypto.randomUUID(),restaurantId:crypto.randomUUID()};await store.createOnce(differentRestaurant,'hash-e',{...operation,order:differentRestaurant});assert.equal((await store.operation(differentRestaurant.restaurantId,operation.key))?.order.restaurantId,differentRestaurant.restaurantId);
 }finally{sqlite.close();}
});


void test('legacy order commit guards publication version inside SQL batch and never leaves an operation after concurrent publish',async()=>{
 const {sql,sqlite}=createD1Fixture();sqlite.exec(readFileSync('drizzle/0002_orders_and_hosts.sql','utf8'));sqlite.exec(readFileSync('drizzle/0006_order_operations.sql','utf8'));sqlite.exec('CREATE TABLE application (id TEXT PRIMARY KEY, revision INTEGER, data TEXT)');
 const store=new D1OrderStore(sql),rid=crypto.randomUUID();sqlite.prepare('INSERT INTO application VALUES (?,0,?)').run(rid,JSON.stringify({published:{version:1},access:{active:true,features:['orders']},settings:{ordersEnabled:true}}));
 const order:OrderRecord={id:crypto.randomUUID(),restaurantId:rid,number:'FICTICIO',status:'confirmed',demo:false,alias:'Ensayo',restaurantName:'Prueba concurrente',menuVersion:1,currency:'USD',totalCents:500,createdAt:new Date().toISOString(),publicExpiresAt:new Date(Date.now()+3600000).toISOString(),cancelledAt:null,lines:[{id:'line',dishId:'dish',dishName:'Plato',quantity:1,basePriceCents:500,unitPriceCents:500,totalCents:500,note:'',options:[]}]};
 const operation={key:crypto.randomUUID(),payloadHash:'same',token:'legacy-test',order};const batch=sql.batch.bind(sql);let raced=false;
 sql.batch=async(statements)=>{if(!raced){raced=true;sqlite.prepare('UPDATE application SET data=? WHERE id=?').run(JSON.stringify({published:{version:2},access:{active:true,features:['orders']},settings:{ordersEnabled:true}}),rid);}return batch(statements);};
 try{
  await assert.rejects(store.createOnce(order,'hash-a',operation,1),/La carta cambió/);assert.equal((await store.list(rid)).length,0);assert.equal(await store.operation(rid,operation.key),null);
  const accepted=await store.createOnce(order,'hash-a',operation,2);assert.equal(accepted.order.id,order.id);sqlite.prepare('UPDATE application SET data=? WHERE id=?').run(JSON.stringify({published:{version:3},access:{active:true,features:['orders']},settings:{ordersEnabled:true}}),rid);assert.equal((await store.createOnce(order,'hash-b',operation,2)).order.id,order.id);assert.equal((await store.list(rid)).length,1);
 }finally{sqlite.close();}
});
