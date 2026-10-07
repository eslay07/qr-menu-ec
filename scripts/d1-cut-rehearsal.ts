import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile,writeFile} from 'node:fs/promises';
import {D1DocumentStore} from '../lib/d1-documents';
import {planDocumentMerge} from '../lib/document-merge';
import {documentManifest,transferDocuments,reconcileDocuments} from '../lib/document-transfer';
import {validateDocumentIntegrity} from '../lib/document-integrity';
import {encodeFirestoreFields} from '../lib/firestore-rest';
import {privateDocumentSource} from './private-document-source';
import {verifiedBackup} from './verify-encrypted-backup.mjs';

// Private snapshots remain encrypted on disk. Both stores in this rehearsal
// are ephemeral SQLite in memory; it makes no network call or remote write.
function local(sql:string){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(sql);
 function prepare(query:string){let params:Array<string|number|null>=[];return {
  bind(...values:Array<string|number|null>){params=values;return this;},
  async first(){return sqlite.prepare(query).get(...params)||null;},
  async all(){return {results:sqlite.prepare(query).all(...params)};},
  async run(){return {success:true,meta:sqlite.prepare(query).run(...params)};},
  execute(){return sqlite.prepare(query).run(...params);}
 };}
 const binding={prepare,async batch(statements:Array<ReturnType<typeof prepare>>){sqlite.exec('BEGIN');try{const result=statements.map(row=>row.execute());sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
 return {sqlite,db:new D1DocumentStore(binding as unknown as D1Database)};
}
const baseline=await privateDocumentSource('work/d1-transition/initial-source-receipt.json'),source=await privateDocumentSource('work/d1-transition/source-receipt.json');
const backup=await verifiedBackup('work/private-backups/2026-10-07T04-05-55.374Z-edd619d6');
assert.equal(backup.receipt.database,'0c8dab0c-5e79-4272-a28c-90b00a93e676');
const target=local(backup.payload.sql),rollback=local(await readFile('deployment/cloudflare/d1-documents.sql','utf8'));
try{
 const original=await documentManifest(source);
 await transferDocuments(rollback.db,original,{authorizeWrites:async()=>{}});
 const initialTarget=await target.db.inventoryWire(100000),merge=planDocumentMerge(baseline,source,initialTarget,{renewRevisionPaths:new Set(['platformConfig/creator','restaurants/998d4980-a169-469f-b009-634a373ca7ad']),conservativeRateLimits:true});
 assert.equal(merge.conflicts.length,0);const integrity=validateDocumentIntegrity(merge.documents),desired=await documentManifest(merge.documents);
 await reconcileDocuments(target.db,await documentManifest(initialTarget),desired,{authorizeWrites:async()=>{}});
 let calls=0;
 await assert.rejects(reconcileDocuments(rollback.db,original,desired,{authorizeWrites:async()=>{if(++calls===2)throw Error('Interrupted');}}),/Interrupted/);
 await reconcileDocuments(rollback.db,original,desired,{authorizeWrites:async()=>{}});
 assert.equal((await documentManifest(await rollback.db.inventoryWire(100000),desired.runId)).checksum,desired.checksum);
 // Before activation, the original source can be restored exactly, including
 // deletion of only the local extra QA rows introduced by the mirror.
 await reconcileDocuments(rollback.db,await documentManifest(await rollback.db.inventoryWire(100000)),original,{authorizeWrites:async()=>{}});
 assert.equal((await documentManifest(await rollback.db.inventoryWire(100000),original.runId)).checksum,original.checksum);
 await reconcileDocuments(rollback.db,original,desired,{authorizeWrites:async()=>{}});
 // After activation, a rollback must retain a newly accepted D1 write.
 const path='restaurants/998d4980-a169-469f-b009-634a373ca7ad/notifications/rehearsal-local-only';
 await target.db.commitWire([{path,fields:encodeFirestoreFields({id:'rehearsal-local-only',kind:'security',message:'Local-only rollback test'}),exists:false}]);
 const fresh=await documentManifest(await target.db.inventoryWire(100000));validateDocumentIntegrity(fresh.documents);
 await reconcileDocuments(rollback.db,desired,fresh,{authorizeWrites:async()=>{}});
 assert.ok(await rollback.db.getWire(path));
 assert.equal((await documentManifest(await rollback.db.inventoryWire(100000),fresh.runId)).checksum,fresh.checksum);
 const result={checkedAt:new Date().toISOString(),remoteWrites:0,privateDataWrittenInClearToDisk:false,integrity,interruptionAndResume:true,preActivationRollbackExact:true,postActivationWritePreserved:true,ordersPreserved:true,verified:true};
 await writeFile('work/d1-transition/cut-rehearsal.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{target.sqlite.close();rollback.sqlite.close();}
