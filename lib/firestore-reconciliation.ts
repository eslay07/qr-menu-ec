import { canonicalWire, type MigrationManifest } from './firestore-remote-migration';
import { FirestoreRest, type TransferDocument } from './firestore-rest';

const same=(a:unknown,b:unknown)=>canonicalWire(a)===canonicalWire(b);
// The isolated mapper allocates random immutable catalog IDs. Replaying an
// identical D1 snapshot must not look like a catalog edit. Reuse the original
// migration ID only when the entire catalog subtree is byte-equivalent.
export function alignUnchangedCatalogs(baseline:MigrationManifest,current:MigrationManifest):MigrationManifest {
 const clone=structuredClone(current);
 const oldRoots=new Map(baseline.documents.filter(d=>/^restaurants\/[^/]+$/.test(d.path)).map(d=>[d.path,d]));
 const subtree=(m:MigrationManifest,prefix:string)=>m.documents.filter(d=>d.path===prefix||d.path.startsWith(prefix+'/')).map(d=>({path:d.path.slice(prefix.length),fields:d.fields})).sort((a,b)=>a.path.localeCompare(b.path));
 for(const root of clone.documents.filter(d=>/^restaurants\/[^/]+$/.test(d.path))){
  const old=oldRoots.get(root.path);if(!old)continue;
  for(const key of ['draftCatalogId','publishedCatalogId']){
   const oldId=old.fields[key]?.stringValue,newId=root.fields[key]?.stringValue;
   if(!oldId||!newId||oldId===newId)continue;
   const oldPrefix=`${root.path}/catalogs/${oldId}`,newPrefix=`${root.path}/catalogs/${newId}`;
   const before=subtree(baseline,oldPrefix),after=subtree(clone,newPrefix);
   if(!before.length||!same(before,after))continue;
   const publicRoot=root.path.replace(/^restaurants\//,'publicMenus/');
   const oldPublic=`${publicRoot}/versions/${oldId}`,newPublic=`${publicRoot}/versions/${newId}`;
   if(key==='publishedCatalogId'&&!same(subtree(baseline,oldPublic),subtree(clone,newPublic)))continue;
   for(const d of clone.documents)if(d.path===newPrefix||d.path.startsWith(newPrefix+'/'))d.path=oldPrefix+d.path.slice(newPrefix.length);
   if(key==='publishedCatalogId'){
    for(const d of clone.documents){
     if(d.path===newPublic||d.path.startsWith(newPublic+'/'))d.path=oldPublic+d.path.slice(newPublic.length);
     if(d.path===publicRoot&&d.fields.versionId?.stringValue===newId)d.fields.versionId={stringValue:oldId};
    }
   }
   root.fields[key]={stringValue:oldId};
  }
 }
 if(new Set(clone.documents.map(d=>d.path)).size!==clone.documents.length)throw Error('Catalog alignment collision');
 return clone;
}
export function reconciliationPlan(baseline:MigrationManifest,current:MigrationManifest,remote:TransferDocument[]) {
 current=alignUnchangedCatalogs(baseline,current);
 if(baseline.project!==current.project)throw Error('Source project mismatch');
 const before=new Map(baseline.documents.map(d=>[d.path,d]));
 const actual=new Map(remote.map(d=>[d.path,d]));
 const source=new Map(current.documents.map(d=>[d.path,d]));
 const writes:Array<{path:string;fields:TransferDocument['fields'];exists?:boolean;updateTime?:string}>=[];
 const conflicts:string[]=[];
 let retainedRemoteChanges=0,alreadyCurrent=0,unchanged=0;
 for(const d of current.documents){
  const old=before.get(d.path),found=actual.get(d.path);
  if(found&&same(found.fields,d.fields)){alreadyCurrent++;continue;}
  // The accepted candidate has already migrated Auth and created real sessions.
  // A source field which did not change is never replayed over those changes.
  if(old&&same(old.fields,d.fields)&&found){retainedRemoteChanges++;continue;}
  if(!found){writes.push({path:d.path,fields:d.fields,exists:false});continue;}
  if(old&&same(old.fields,found.fields)){
   if(!found.updateTime)throw Error('Missing concurrency precondition');
   writes.push({path:d.path,fields:d.fields,updateTime:found.updateTime});continue;
  }
  conflicts.push(d.path);
 }
 // Source-side removals can be TTL cleanup or old immutable catalogs. Preserve
 // the migrated copy and every order; deletion is not part of the final cut.
 const retainedSourceRemovals=baseline.documents.filter(d=>!source.has(d.path)).length;
 const remoteOnly=remote.filter(d=>!source.has(d.path)).length;
 unchanged=alreadyCurrent;
 return {writes,conflicts,retainedRemoteChanges,retainedSourceRemovals,remoteOnly,unchanged};
}

export async function applyReconciliation(db:FirestoreRest,baseline:MigrationManifest,current:MigrationManifest,controls:{authorizeWrites:()=>Promise<void>;afterWrite?:(completed:number)=>Promise<void>;initialSnapshot?:TransferDocument[];excludedSubtrees?:string[]}) {
 if(!db.isEmulator&&db.root!=='projects/qr-menu-6981a/databases/(default)/documents')throw Error('Invalid reconciliation destination');
 const plan=reconciliationPlan(baseline,current,controls.initialSnapshot||await db.inventoryWire(100000,controls.excludedSubtrees));
 if(plan.conflicts.length)throw Error(`Reconciliation stopped: ${plan.conflicts.length} concurrent conflicts`);
 let completed=0;
 for(const write of plan.writes){
  await controls.authorizeWrites();
  await db.commitWire([write]);
  if(!same((await db.getWire(write.path))?.fields,write.fields))throw Error('Reconciliation checksum verification failed');
  completed++;await controls.afterWrite?.(completed);
 }
 const verified=reconciliationPlan(baseline,current,await db.inventoryWire(100000,controls.excludedSubtrees));
 if(verified.writes.length||verified.conflicts.length)throw Error('Final reconciliation verification failed');
 return {updatedDocuments:completed,retainedRemoteChanges:verified.retainedRemoteChanges,remoteOnly:verified.remoteOnly,deletedDocuments:0,verified:true};
}
