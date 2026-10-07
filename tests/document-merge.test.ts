import test from 'node:test';
import assert from 'node:assert/strict';
import {planDocumentMerge} from '../lib/document-merge';
test('reviewed rate-limit merge never lowers attempts or expiry and rejects unknown fields',()=>{
 const row=(count:number,resetAt:string)=>({path:'rateLimits/hashed',fields:{keyHash:{stringValue:'hash'},bucket:{stringValue:'login'},count:{integerValue:String(count)},resetAt:{timestampValue:resetAt}}});
 const b=row(1,'2026-10-07T05:00:00Z'),s=row(3,'2026-10-07T05:15:00Z'),t=row(2,'2026-10-07T05:20:00Z');
 assert.equal(planDocumentMerge([b],[s],[t]).conflicts.length,1);
 const merged=planDocumentMerge([b],[s],[t],{conservativeRateLimits:true});
 assert.equal(merged.conflicts.length,0);assert.equal(merged.documents[0].fields.count.integerValue,'5');assert.equal(merged.documents[0].fields.resetAt.timestampValue,'2026-10-07T05:20:00.000Z');
 const foreign={...t,fields:{...t.fields,role:{stringValue:'admin'}}};
 assert.equal(planDocumentMerge([b],[s],[foreign],{conservativeRateLimits:true}).conflicts.length,1);
});
const doc=(name:string)=>({path:'restaurants/r',fields:{name:{stringValue:name}}});
test('merge preserves source updates and independent QA additions without writing',()=>{
 const result=planDocumentMerge([doc('Old')],[doc('New')],[doc('Old'),{path:'restaurants/r/pushDevices/device',fields:{enabled:{booleanValue:true}}}]);
 assert.equal(result.conflicts.length,0);assert.equal(result.documents.length,2);assert.deepEqual(result.documents[0],doc('New'));assert.equal(result.writeAuthorized,false);
});
test('merge combines distinct fields but refuses concurrent changes to the same field',()=>{
 const b=doc('Old'),s=doc('New'),t={...b,fields:{...b.fields,other:{booleanValue:true}}};
 assert.equal(planDocumentMerge([b],[s],[t]).conflicts.length,0);
 assert.deepEqual(planDocumentMerge([b],[s],[doc('Different')]).conflicts,[{path:b.path,fields:['name']}]);
});
test('merge preserves deletion only when the other side did not change and rejects duplicates',()=>{
 assert.equal(planDocumentMerge([doc('Old')],[],[doc('Old')]).documents.length,0);
 assert.equal(planDocumentMerge([doc('Old')],[],[doc('Changed')]).conflicts.length,1);
 assert.throws(()=>planDocumentMerge([doc('Old'),doc('Old')],[],[]),/Duplicate/);
});

test('reviewed revision counters renew above both branches without masking content conflicts',()=>{
 const row=(revision:number,name='Same')=>({...doc(name),fields:{...doc(name).fields,revision:{integerValue:String(revision)}}});
 const options={renewRevisionPaths:new Set(['restaurants/r'])};
 assert.equal(planDocumentMerge([row(1)],[row(2)],[row(3)]).conflicts.length,1);
 const merged=planDocumentMerge([row(1)],[row(2)],[row(3)],options);
 assert.equal(merged.conflicts.length,0);assert.equal(merged.documents[0].fields.revision.integerValue,'4');
 assert.equal(planDocumentMerge([row(1)],[row(2,'Source')],[row(3,'Target')],options).conflicts.length,1);
 assert.equal(planDocumentMerge([row(3)],[row(2)],[row(4)],options).conflicts.length,1);
});
