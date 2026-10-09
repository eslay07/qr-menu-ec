import test from 'node:test';
import assert from 'node:assert/strict';
import {documentManifest,transferDocuments,reconcileDocuments} from '../lib/document-transfer';
import type {TransferDocument,FirestoreRest} from '../lib/firestore-rest';
function target(){const rows=new Map<string,TransferDocument>();let writes=0;return {rows,get writes(){return writes;},api:{async inventoryWire(){return [...rows.values()];},async getWire(path:string){return rows.get(path)||null;},async commitWire(batch:Array<{path:string;fields?:TransferDocument['fields']}>){for(const row of batch){assert.ok(!rows.has(row.path));rows.set(row.path,{path:row.path,fields:structuredClone(row.fields!)});writes++;}}} as Pick<FirestoreRest,'inventoryWire'|'getWire'|'commitWire'>};}
void test('provider migration resumes after interruption, records document checksums and preserves UUID/wire timestamps',async()=>{
 const destination=target(),rows=Array.from({length:25},(_,i)=>({path:`restaurants/r/orders/order-${i}`,fields:{createdAt:{timestampValue:'2026-10-05T00:00:00.123456Z'},total:{integerValue:String(i)}}}));
 const manifest=await documentManifest(rows);let recorded=0;
 await assert.rejects(transferDocuments(destination.api,manifest,{authorizeWrites:async()=>{},afterBatch:async records=>{recorded+=records.length;throw Error('Interrupted');}}),/Interrupted/);
 assert.equal(recorded,20);assert.equal(destination.writes,20);
 const result=await transferDocuments(destination.api,manifest,{authorizeWrites:async()=>{}});
 assert.equal(result.verified,true);assert.equal(result.documents,25);assert.equal(destination.writes,25);
 assert.deepEqual(destination.rows.get(rows[0].path)?.fields,rows[0].fields);
});
void test('three-way reconciliation rejects an independently changed target before any write',async()=>{
 const destination=target(),baseline=await documentManifest([{path:'restaurants/r',fields:{name:{stringValue:'Old'}}}]);
 await transferDocuments(destination.api,baseline,{authorizeWrites:async()=>{}});
 const current=await documentManifest([{path:'restaurants/r',fields:{name:{stringValue:'New'}}}]);
 destination.rows.set('restaurants/r',{path:'restaurants/r',fields:{name:{stringValue:'Target change'}}});
 await assert.rejects(reconcileDocuments(destination.api,baseline,current,{authorizeWrites:async()=>{}}),/independientemente/);
 assert.equal(destination.writes,1);
});
void test('migration refuses a changed destination, tampered manifest or missing freeze permission',async()=>{
 const destination=target(),manifest=await documentManifest([{path:'restaurants/r',fields:{name:{stringValue:'R'}}}]);
 await assert.rejects(transferDocuments(destination.api,{...manifest,checksum:'bad'},{authorizeWrites:async()=>{}}),/Checksum/);
 assert.equal(destination.writes,0);
 await assert.rejects(transferDocuments(destination.api,manifest,{authorizeWrites:async()=>{throw Error('Not authorized');}}),/Not authorized/);
 assert.equal(destination.writes,0);
 destination.rows.set('restaurants/unknown',{path:'restaurants/unknown',fields:{}});
 await assert.rejects(transferDocuments(destination.api,manifest,{authorizeWrites:async()=>{}}),/no se sobrescribirá/);
 assert.equal(destination.writes,0);
});

void test('reconciliation bounds large batches and resumes updates, additions and deletions',async()=>{
 const rows=new Map<string,TransferDocument>();let version=0;const batches:number[]=[];
 const api={async inventoryWire(){return [...rows.values()];},async getWire(path:string){return rows.get(path)||null;},async commitWire(batch:Array<{path:string;fields?:TransferDocument['fields'];delete?:boolean;exists?:boolean;updateTime?:string}>){
  assert.ok(Buffer.byteLength(JSON.stringify(batch))<3100000);batches.push(batch.length);
  for(const row of batch){const previous=rows.get(row.path);if(row.exists===false)assert.equal(previous,undefined);if(row.updateTime)assert.equal(previous?.updateTime,row.updateTime);}
  for(const row of batch){if(row.delete)rows.delete(row.path);else rows.set(row.path,{path:row.path,fields:structuredClone(row.fields!),updateTime:String(++version)});}
 }} as Pick<FirestoreRest,'inventoryWire'|'getWire'|'commitWire'>;
 const baseline=await documentManifest([{path:'restaurants/r',fields:{name:{stringValue:'Old'}}},{path:'restaurants/deleted',fields:{}}]);
 await transferDocuments(api,baseline,{authorizeWrites:async()=>{}});batches.length=0;
 const current=await documentManifest([{path:'restaurants/r',fields:{name:{stringValue:'New'}}},...Array.from({length:8},(_,i)=>({path:`restaurants/new-${i}`,fields:{data:{stringValue:'x'.repeat(700000)}}}))]);
 let calls=0;
 await assert.rejects(reconcileDocuments(api,baseline,current,{authorizeWrites:async()=>{if(++calls===2)throw Error('Interrupted');}}),/Interrupted/);
 assert.equal(rows.has('restaurants/deleted'),false);
 const result=await reconcileDocuments(api,baseline,current,{authorizeWrites:async()=>{}});
 assert.equal(result.verified,true);assert.equal(result.documents,9);assert.ok(batches.length>1);
});
