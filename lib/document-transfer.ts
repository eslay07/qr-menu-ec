import {firestoreId,type TransferDocument,type FirestoreRest} from './firestore-rest';
type Destination=Pick<FirestoreRest,'inventoryWire'|'getWire'|'commitWire'>;
export type DocumentManifest={format:'qrmenu-document-transfer-v1';runId:string;checksum:string;documents:Array<{path:string;fields:TransferDocument['fields'];checksum:string}>};
export function canonicalDocument(value:unknown):string{
 if(Array.isArray(value))return '['+value.map(canonicalDocument).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,value])=>JSON.stringify(key)+':'+canonicalDocument(value)).join(',')+'}';
 return JSON.stringify(value);
}
async function checksum(value:unknown){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalDocument(value)));return [...new Uint8Array(bytes)].map(value=>value.toString(16).padStart(2,'0')).join('');}
export async function documentManifest(rows:TransferDocument[],runId=crypto.randomUUID()):Promise<DocumentManifest>{
 if(!/^[a-f0-9-]{36}$/.test(runId)||rows.length>100000||new Set(rows.map(row=>row.path)).size!==rows.length)throw Error('Manifiesto inválido.');
 const documents=[];
 for(const row of [...rows].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)){
  const parts=row.path.split('/');parts.forEach(firestoreId);if(parts.length%2)throw Error('Ruta de documento inválida.');
  documents.push({path:row.path,fields:row.fields,checksum:await checksum(row.fields)});
 }
 return {format:'qrmenu-document-transfer-v1',runId,checksum:await checksum(documents),documents};
}
export async function transferDocuments(target:Destination,manifest:DocumentManifest,controls:{authorizeWrites:()=>Promise<void>;afterBatch?:(records:Array<{path:string;checksum:string}>)=>Promise<void>}){
 const verified=await documentManifest(manifest.documents,manifest.runId);
 if(verified.checksum!==manifest.checksum||verified.documents.some((row,i)=>row.checksum!==manifest.documents[i]?.checksum))throw Error('Checksum de manifiesto inválido.');
 const existing=await target.inventoryWire(100000),expected=new Map(manifest.documents.map(row=>[row.path,row]));
 for(const row of existing){const source=expected.get(row.path);if(!source||await checksum(row.fields)!==source.checksum)throw Error('Destino modificado o ajeno; no se sobrescribirá.');}
 const present=new Set(existing.map(row=>row.path));
 const pending=manifest.documents.filter(row=>!present.has(row.path));
 let completed=existing.length;
 for(let offset=0;offset<pending.length;){
  const batch:typeof pending=[];let bytes=0;
  while(offset<pending.length&&batch.length<20){const next=pending[offset],size=new TextEncoder().encode(JSON.stringify(next.fields)).length;if(size>900000)throw Error('Documento excesivo.');if(batch.length&&bytes+size>3000000)break;batch.push(next);bytes+=size;offset++;}
  await controls.authorizeWrites();
  await target.commitWire(batch.map(row=>({path:row.path,fields:row.fields,exists:false})));
  const records=[];
  for(const row of batch){const saved=await target.getWire(row.path);if(!saved||await checksum(saved.fields)!==row.checksum)throw Error('Documento importado no coincide.');records.push({path:row.path,checksum:row.checksum});}
  completed+=batch.length;await controls.afterBatch?.(records);
 }
 const actual=await documentManifest(await target.inventoryWire(100000),manifest.runId);
 if(actual.checksum!==manifest.checksum)throw Error('La verificación final no coincide.');
 return {runId:manifest.runId,checksum:manifest.checksum,documents:completed,verified:true};
}

// Three-way reconciliation: a target edited independently is a conflict, never
// silently overwritten. Apply only with a verified write freeze at cutover.
export async function reconcileDocuments(target:Destination,baseline:DocumentManifest,current:DocumentManifest,controls:{authorizeWrites:()=>Promise<void>}){
 for(const manifest of [baseline,current]){
  const checked=await documentManifest(manifest.documents,manifest.runId);
  if(checked.checksum!==manifest.checksum)throw Error('Checksum de conciliación inválido.');
 }
 const actual=await target.inventoryWire(100000),old=new Map(baseline.documents.map(row=>[row.path,row])),next=new Map(current.documents.map(row=>[row.path,row])),present=new Map(actual.map(row=>[row.path,row]));
 const writes:Array<{path:string;fields?:TransferDocument['fields'];delete?:boolean;exists?:boolean;updateTime?:string}>=[];
 for(const row of actual){
  const previous=old.get(row.path),wanted=next.get(row.path),hash=await checksum(row.fields);
  if(wanted?.checksum===hash)continue;
  if(!previous||previous.checksum!==hash)throw Error('Conflicto de conciliación: el destino cambió independientemente.');
  writes.push(wanted?{path:row.path,fields:wanted.fields,updateTime:row.updateTime}:{path:row.path,delete:true,updateTime:row.updateTime});
 }
 for(const row of current.documents)if(!present.has(row.path)){
  // A prior partial reconciliation may already have applied a source deletion,
  // but a missing document still desired by the source is never intentional.
  if(old.has(row.path))throw Error('Documento del destino ausente; revisar antes de restaurar.');
  writes.push({path:row.path,fields:row.fields,exists:false});
 }
 // Validate every size before the first mutation; reconciliation must obey
 // the same payload bounds as the initial import, including resumed runs.
 const sizes=writes.map(row=>new TextEncoder().encode(JSON.stringify(row)).length);
 if(sizes.some(size=>size>900000))throw Error('Documento excesivo.');
 for(let offset=0;offset<writes.length;){
  const batch:typeof writes=[];let bytes=0;
  while(offset<writes.length&&batch.length<20){
   const size=sizes[offset];if(batch.length&&bytes+size>3000000)break;
   batch.push(writes[offset++]);bytes+=size;
  }
  await controls.authorizeWrites();await target.commitWire(batch);
 }
 const verified=await documentManifest(await target.inventoryWire(100000),current.runId);
 if(verified.checksum!==current.checksum)throw Error('Conciliación final no coincide.');
 return {updated:writes.length,documents:verified.documents.length,checksum:verified.checksum,verified:true};
}
