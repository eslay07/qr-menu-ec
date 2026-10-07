import { importRemoteManifest, validateManifest } from '../lib/firestore-remote-migration.ts';
import { migrationStage } from './migration-diagnostics.mjs';

export async function inspectPlanUntilFirstWrite(db, plan, checksum) {
  await migrationStage('plan.validate',()=>validateManifest(plan,checksum));
  const boundary=Error('READ_ONLY_WRITE_BOUNDARY');
  let stopped=false;
  const guarded=new Proxy(db,{get(target,key){
    if(key==='commit'||key==='commitWire')return async()=>{stopped=true;throw boundary;};
    return Reflect.get(target,key);
  }});
  try {
    await migrationStage('plan.read-only-import-path',async()=>{
      try {await importRemoteManifest(guarded,plan,checksum,{authorizeWrites:async()=>{}});}
      catch(error){if(error!==boundary)throw error;}
    });
  }catch(error){if(error!==boundary)throw error;}
  if(!stopped)throw Error('Expected first-write boundary was not reached');
  return {manifestDocuments:plan.documents.length,firstWriteReached:true,documentWrites:0};
}
