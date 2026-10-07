import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDocumentIntegrity} from '../lib/document-integrity';
import {encodeFirestoreFields} from '../lib/firestore-rest';
const doc=(path:string,data:Record<string,unknown>)=>({path,fields:encodeFirestoreFields(data)});
const valid=[doc('restaurants/r',{restaurantId:'r',draftCatalogId:'c',access:{active:true}}),doc('restaurants/r/catalogs/c',{}),doc('restaurants/r/private/auth',{security:{firebaseUid:'u'}}),doc('restaurants/r/settings/general',{}),doc('restaurants/r/members/u',{role:'owner',active:true}),doc('users/u',{}),doc('restaurants/r/orders/o',{id:'o',restaurantId:'r'}),doc('restaurants/r/orders/o/lines/l',{id:'l'})];
test('integrity accepts scoped catalog, owner membership and orders',()=>assert.deepEqual(validateDocumentIntegrity(valid),{documents:8,restaurants:1,orders:1,lines:1,verified:true}));
test('integrity rejects missing references, foreign orders and owner activation mismatches',()=>{
 assert.throws(()=>validateDocumentIntegrity(valid.filter(row=>row.path!=='restaurants/r/catalogs/c')),/Missing referenced catalog/);
 assert.throws(()=>validateDocumentIntegrity([...valid.filter(row=>row.path!=='restaurants/r/orders/o'),doc('restaurants/r/orders/o',{id:'o',restaurantId:'other'})]),/Order identity/);
 assert.throws(()=>validateDocumentIntegrity([...valid.filter(row=>row.path!=='restaurants/r/members/u'),doc('restaurants/r/members/u',{role:'owner',active:false})]),/activation/);
 assert.throws(()=>validateDocumentIntegrity([...valid,valid[0]]),/Duplicate/);
});
