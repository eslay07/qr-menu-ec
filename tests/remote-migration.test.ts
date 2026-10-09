import test from 'node:test';
import assert from 'node:assert/strict';
import { FirestoreRest, encodeFirestoreFields } from '../lib/firestore-rest';
import { canonicalWire, importRemoteManifest, rollbackRemoteManifest, type MigrationManifest } from '../lib/firestore-remote-migration';
import { digest } from '../lib/security';
const options = { skip: !process.env.FIRESTORE_EMULATOR_HOST, timeout: 120000 };
async function setup(count=45) {
  const db = new FirestoreRest(`demo-transfer-${crypto.randomUUID()}`,process.env.FIRESTORE_EMULATOR_HOST!);
  const plan: MigrationManifest = { version:1,project:'qr-menu-6981a',database:'(default)',runId:crypto.randomUUID(),sourceChecksum:'a'.repeat(64),
    documents:Array.from({length:count},(_,i)=>({path:`restaurants/test/orders/${i}`,fields:encodeFirestoreFields({id:String(i),amount:123,at:new Date('2026-01-01T00:00:00Z'),nested:{unicode:'Menú ñ',enabled:true}})})) };
  return {db,plan,checksum:await digest(canonicalWire(plan))};
}
const controls={authorizeWrites:async()=>{}};
void test('remote executor resumes interrupted atomic batches, preserves typed fields and has no duplicates',options,async()=>{
  const {db,plan,checksum}=await setup();
  await assert.rejects(importRemoteManifest(db,plan,checksum,{...controls,afterBatch:async()=>{throw Error('interrupted');}}),/interrupted/);
  assert.equal((await db.inventoryWire()).length,81);
  const result=await importRemoteManifest(db,plan,checksum,controls);
  assert.equal(result.documentsVerified,45);
  assert.equal((await db.inventoryWire()).length,91);
  assert.deepEqual(await importRemoteManifest(db,plan,checksum,controls),result);
  for(const d of plan.documents) assert.equal(canonicalWire((await db.getWire(d.path))!.fields),canonicalWire(d.fields));
});
void test('lost commit acknowledgement resumes from the atomic per-document journal',options,async()=>{
  const {db,plan,checksum}=await setup(3);
  const commit=db.commitWire.bind(db);
  db.commitWire=async writes=>{await commit(writes);throw Error('lost acknowledgement');};
  await assert.rejects(importRemoteManifest(db,plan,checksum,controls));
  db.commitWire=commit;
  assert.equal((await importRemoteManifest(db,plan,checksum,controls)).status,'verified');
});
void test('checksum changes, modified documents and missing journals stop without overwriting',options,async()=>{
  const {db,plan,checksum}=await setup(2);
  await assert.rejects(importRemoteManifest(db,plan,'b'.repeat(64),controls),/checksum/);
  assert.equal((await db.inventoryWire()).length,0);
  await importRemoteManifest(db,plan,checksum,controls);
  await db.commit([{path:plan.documents[0].path,data:{changed:true}}]);
  await assert.rejects(importRemoteManifest(db,plan,checksum,controls),/changed/);
  await assert.rejects(rollbackRemoteManifest(db,plan,checksum,controls),/Changed/);
  assert.equal((await db.get(plan.documents[0].path))!.data.changed,true);
  assert.ok(await db.get(plan.documents[1].path));
});
void test('inventory detects documents below missing parents; nonempty target is never overwritten',options,async()=>{
  const {db,plan,checksum}=await setup(1);
  await db.commit([{path:'unknown/missing/nested/real',data:{keep:true},exists:false}]);
  assert.equal((await db.inventoryWire()).length,1);
  await assert.rejects(importRemoteManifest(db,plan,checksum,controls),/not empty/);
  assert.equal(await db.get(`migrationRuns/${plan.runId}`),null);
});
void test('loss of write freeze stops before next batch; owned-only rollback can be interrupted and resumed',options,async()=>{
  const {db,plan,checksum}=await setup();
  let frozen=true;
  await assert.rejects(importRemoteManifest(db,plan,checksum,{authorizeWrites:async()=>{if(!frozen)throw Error('freeze lost');},afterBatch:async()=>{frozen=false;}}),/freeze lost/);
  assert.equal((await db.inventoryWire()).length,81);
  await importRemoteManifest(db,plan,checksum,controls);
  await assert.rejects(rollbackRemoteManifest(db,plan,checksum,{...controls,afterBatch:async()=>{throw Error('rollback interrupted');}}),/rollback interrupted/);
  await rollbackRemoteManifest(db,plan,checksum,controls);
  const remaining=await db.inventoryWire();
  assert.equal(remaining.length,1);
  assert.equal((await db.get(`migrationRuns/${plan.runId}`))!.data.status,'rolled-back');
});
void test('authorization failure performs zero writes',options,async()=>{
  const {db,plan,checksum}=await setup(1);
  await assert.rejects(importRemoteManifest(db,plan,checksum,{authorizeWrites:async()=>{throw Error('not authorized');}}),/not authorized/);
  assert.equal((await db.inventoryWire()).length,0);
});
