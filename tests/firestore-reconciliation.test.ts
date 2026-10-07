import test from 'node:test';
import assert from 'node:assert/strict';
import { reconciliationPlan } from '../lib/firestore-reconciliation';
import { encodeFirestoreFields } from '../lib/firestore-rest';
import type { MigrationManifest } from '../lib/firestore-remote-migration';
const doc=(path:string,data:Record<string,unknown>)=>({path,fields:encodeFirestoreFields(data),updateTime:'2026-10-05T01:00:00Z'});
const manifest=(documents:MigrationManifest['documents']):MigrationManifest=>({version:1,project:'qr-menu-6981a',database:'(default)',runId:'40f63a32-d25a-4162-a938-eb01434411b4',sourceChecksum:'a'.repeat(64),documents});
test('Final reconciliation preserves Firebase Auth, sessions and candidate-only documents',()=>{
 const old=doc('platformConfig/creator',{passwordHash:'legacy'});
 const remote=doc(old.path,{firebaseUid:'verified',passwordHash:null});
 const plan=reconciliationPlan(manifest([old]),manifest([old]),[remote,doc('platformConfig/sessionGrants/entries/live',{active:true})]);
 assert.equal(plan.writes.length,0);assert.equal(plan.retainedRemoteChanges,1);assert.equal(plan.remoteOnly,1);
});
test('New D1 documents and unchanged remote documents receive guarded writes',()=>{
 const old=doc('restaurants/a',{name:'old'}),fresh=doc('restaurants/a',{name:'new'});
 const added=doc('auditEvents/new',{event:'login'});
 const plan=reconciliationPlan(manifest([old]),manifest([fresh,added]),[old]);
 assert.equal(plan.writes.length,2);assert.equal(plan.writes[0].updateTime,old.updateTime);assert.equal(plan.writes[1].exists,false);
});
test('Concurrent edits stop the cut instead of guessing or overwriting',()=>{
 const old=doc('restaurants/a',{name:'old'});
 const plan=reconciliationPlan(manifest([old]),manifest([doc(old.path,{name:'source'})]),[doc(old.path,{name:'remote'})]);
 assert.deepEqual(plan.conflicts,[old.path]);assert.equal(plan.writes.length,0);
});
test('Resumption recognizes already-written changes; removals never delete orders',()=>{
 const old=doc('restaurants/a',{name:'old'}),fresh=doc(old.path,{name:'new'}),order=doc('restaurants/a/orders/1',{totalCents:500});
 const plan=reconciliationPlan(manifest([old,order]),manifest([fresh]),[fresh,order]);
 assert.equal(plan.writes.length,0);assert.equal(plan.conflicts.length,0);assert.equal(plan.retainedSourceRemovals,1);
});
test('Independent rehearsal UUIDs do not create false catalog conflicts',()=>{
 const oldRoot=doc('restaurants/a',{draftCatalogId:'original'}),newRoot=doc('restaurants/a',{draftCatalogId:'rehearsal'});
 const oldDish=doc('restaurants/a/catalogs/original/dishes/1',{name:'same'}),newDish=doc('restaurants/a/catalogs/rehearsal/dishes/1',{name:'same'});
 const oldHeader=doc('restaurants/a/catalogs/original',{name:'menu'}),newHeader=doc('restaurants/a/catalogs/rehearsal',{name:'menu'});
 const source=manifest([newRoot,newHeader,newDish]);
 const plan=reconciliationPlan(manifest([oldRoot,oldHeader,oldDish]),source,[doc(oldRoot.path,{draftCatalogId:'auth-renewed'}),oldHeader,oldDish]);
 assert.equal(plan.writes.length,0);assert.equal(plan.conflicts.length,0);assert.equal(source.documents[0].fields.draftCatalogId.stringValue,'rehearsal');
});
test('Unchanged published catalog aliases align atomically, changed dishes do not',()=>{
 const old=[doc('restaurants/a',{publishedCatalogId:'original'}),doc('restaurants/a/catalogs/original',{name:'menu'}),doc('publicMenus/a',{versionId:'original'}),doc('publicMenus/a/versions/original',{name:'menu'}),doc('publicMenus/a/versions/original/dishes/1',{name:'same'})];
 const fresh=[doc('restaurants/a',{publishedCatalogId:'rehearsal'}),doc('restaurants/a/catalogs/rehearsal',{name:'menu'}),doc('publicMenus/a',{versionId:'rehearsal'}),doc('publicMenus/a/versions/rehearsal',{name:'menu'}),doc('publicMenus/a/versions/rehearsal/dishes/1',{name:'same'})];
 assert.equal(reconciliationPlan(manifest(old),manifest(fresh),old).writes.length,0);
 fresh[4]=doc(fresh[4].path,{name:'changed'});
 assert.ok(reconciliationPlan(manifest(old),manifest(fresh),old).writes.length>0);
});
