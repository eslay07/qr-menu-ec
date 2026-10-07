import {canonicalDocument} from './document-transfer';
import type {TransferDocument,WireFields} from './firestore-rest';
// Planning only: never writes. Concurrent changes to the same top-level field
// are conflicts, including deletion versus an independent modification.
export function planDocumentMerge(baseline:TransferDocument[],source:TransferDocument[],target:TransferDocument[],options:{renewRevisionPaths?:ReadonlySet<string>;conservativeRateLimits?:boolean}={}){
 const maps=[baseline,source,target].map(rows=>new Map(rows.map(row=>[row.path,row])));
 if(maps.some((map,i)=>map.size!==[baseline,source,target][i].length))throw Error('Duplicate document paths.');
 const [old,fresh,destination]=maps,documents:TransferDocument[]=[],conflicts:Array<{path:string;fields:string[]}>=[];
 const same=(a:unknown,b:unknown)=>a===undefined?b===undefined:b!==undefined&&canonicalDocument(a)===canonicalDocument(b);
 for(const path of [...new Set([...old.keys(),...fresh.keys(),...destination.keys()])].sort()){
  const b=old.get(path),s=fresh.get(path),t=destination.get(path);
  if(same(s?.fields,t?.fields)){if(s)documents.push(s);continue;}
  if(same(b?.fields,t?.fields)){if(s)documents.push(s);continue;}
  if(same(b?.fields,s?.fields)){if(t)documents.push(t);continue;}
  if(!s||!t){conflicts.push({path,fields:['__document__']});continue;}
  if(options.conservativeRateLimits&&/^rateLimits\/[^/]+$/.test(path)){
   const allowed=new Set(['keyHash','bucket','count','resetAt']);
   const counts=[s,t].map(row=>row.fields.count?.integerValue);
   const resets=[s,t].map(row=>row.fields.resetAt?.timestampValue);
   const numbers=counts.map(value=>Number(value));
   if([s,t].every(row=>Object.keys(row.fields).every(key=>allowed.has(key)))&&same(s.fields.keyHash,t.fields.keyHash)&&same(s.fields.bucket,t.fields.bucket)&&s.fields.keyHash?.stringValue&&s.fields.bucket?.stringValue&&counts.every(value=>value!==undefined&&/^\d+$/.test(value))&&numbers.every(Number.isSafeInteger)&&Number.isSafeInteger(numbers[0]+numbers[1])&&resets.every(value=>value!==undefined&&Number.isFinite(Date.parse(value)))){
    // Both branches consumed attempts independently. Sum conservatively,
    // including any shared baseline, and keep the latest expiry: never weaken
    // a lockout or choose a lower count merely to make migration succeed.
    documents.push({path,fields:{keyHash:s.fields.keyHash,bucket:s.fields.bucket,count:{integerValue:String(numbers[0]+numbers[1])},resetAt:{timestampValue:new Date(Math.max(...resets.map(value=>Date.parse(value!)))).toISOString()}}});continue;
   }
  }
  const fields:WireFields={},changed:string[]=[];
  for(const key of new Set([...Object.keys(b?.fields||{}),...Object.keys(s.fields),...Object.keys(t.fields)])){
   const prior=b?.fields[key],left=s.fields[key],right=t.fields[key];let chosen;
   if(same(left,right)||same(prior,right))chosen=left;
   else if(same(prior,left))chosen=right;
   else if(key==='revision'&&options.renewRevisionPaths?.has(path)){
    const values=[prior,left,right].map(value=>value?.integerValue);
    if(values.some(value=>value===undefined||!/^\d+$/.test(value))){changed.push(key);continue;}
    const numbers=values.map(value=>Number(value));
    if(numbers.some(value=>!Number.isSafeInteger(value))||numbers[1]<numbers[0]||numbers[2]<numbers[0]||Math.max(...numbers)>=Number.MAX_SAFE_INTEGER){changed.push(key);continue;}
    chosen={integerValue:String(Math.max(...numbers)+1)};
   }
   else{changed.push(key);continue;}
   if(chosen!==undefined)fields[key]=chosen;
  }
  if(changed.length)conflicts.push({path,fields:changed});else documents.push({path,fields});
 }
 return {documents,conflicts,writeAuthorized:false as const};
}
