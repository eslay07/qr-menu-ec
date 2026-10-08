import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createD1Fixture } from './d1-fixture';
import { FirestoreRestaurantStore } from '../lib/firestore-store';
import { blankCatalog, defaultSettings } from '../lib/contracts';
import type { State } from '../lib/store';
register(new URL('./cloudflare-test-loader.mjs', import.meta.url));
const { default: worker } = await import('../deployment/cloudflare/worker');
const context = { waitUntil(promise: Promise<unknown>) { void promise.catch(() => undefined); } } as ExecutionContext;
const origin='https://qr-menu-ec.consola.workers.dev';
async function fixture() {
 const {db,sql,sqlite}=createD1Fixture();
 const a=crypto.randomUUID(),b=crypto.randomUUID();
 const make=async(id:string,name:string,slug:string)=>{
   const store=new FirestoreRestaurantStore(db,id,{async mediaGet(){return null;},async mediaPut(){}});
   const catalog={...structuredClone(blankCatalog),name,nameConfirmed:true,dishes:[{id:'dish',name:'Plato '+name,description:'Ficticio',categoryId:'principales',priceCents:500,available:true,image:'',modifierGroups:[]}]};
   const state:State={schemaVersion:1,restaurantId:id,ownerId:'owner:'+id,draft:{...structuredClone(catalog),name:'BORRADOR PRIVADO '+name},settings:structuredClone(defaultSettings),published:{version:1,at:new Date().toISOString(),catalog:structuredClone(catalog)},license:null,password:{salt:'private-salt',hash:'private-hash'},recoveryHash:'private-recovery',sessionEpoch:1,failures:{count:0,until:0},createdAt:new Date().toISOString(),access:{active:true,features:['orders','promotions'],maxDishes:40},security:{emailCiphertext:'PRIVATE CONTACT '+name}};
   assert.equal(await store.commit(state,null),true);
   await db.commit([{path:'menuAliases/'+slug,data:{restaurantId:id,slug},exists:false},{path:'restaurantPublicPaths/'+id,data:{restaurantId:id,slug},exists:false}]);
   return {store,state};
 };
 const [first,second]=await Promise.all([make(a,'Ficticio A','ficticio-a'),make(b,'Ficticio B','ficticio-b')]);
 const env={DB:sql,DATA_PROVIDER:'d1-documents' as const,ASSETS:{fetch:async()=>new Response('<html><body>Menu shell</body></html>',{headers:{'Content-Type':'text/html'}})}} as unknown as Parameters<typeof worker.fetch>[1];
 const request=(path:string,targetEnv=env)=>worker.fetch(new Request(origin+path),targetEnv,context);
 return {db,sql,sqlite,a,b,first,second,env,request};
}
void test('readable aliases route isolated public API and menu shells, reject missing/private paths and preserve UUID links',async()=>{
 const f=await fixture();try {
   assert.equal((await f.request('/m/unknown')).status,404);
   for(const [slug,id,name] of [['ficticio-a',f.a,'Ficticio A'],['ficticio-b',f.b,'Ficticio B']]){
     const shell=await f.request('/m/'+slug);assert.equal(shell.status,200);assert.match(await shell.text(),/Menu shell/);
     const explicitShell=await f.request('/m/'+slug+'/menu');assert.equal(explicitShell.status,200);
     const response=await f.request('/m/'+slug+'/api/v1/menu');assert.equal(response.status,200);
     const body=await response.json() as {catalog:{name:string};version:number};assert.equal(body.catalog.name,name);assert.equal(body.version,1);
     assert.doesNotMatch(JSON.stringify(body),/BORRADOR PRIVADO|PRIVATE CONTACT|private-hash|private-recovery/);
     const old=await f.request('/r/'+id+'/api/v1/menu');assert.equal(old.status,200);assert.deepEqual(await old.json(),body);
     assert.equal((await f.request('/r/'+id+'/menu')).status,200);
     assert.equal((await f.request('/m/'+slug+'/preview')).status,404);
     assert.equal((await f.request('/m/'+slug+'/api/v1/state')).status,401);
   }
 }finally{f.sqlite.close();}
});
void test('publication pointer refreshes warm caches in separate isolates and keeps another restaurant stable',async()=>{
 const f=await fixture();try {
   const isolate2={...f.env};
   for(const env of [f.env,isolate2])assert.equal(((await (await f.request('/m/ficticio-a/api/v1/menu',env)).json()) as {version:number}).version,1);
   const stored=(await f.first.store.read())!;stored.state.published!.version=2;stored.state.published!.catalog.name='Ficticio A actualizado';assert.equal(await f.first.store.commit(stored.state,stored.revision),true);
   for(const env of [f.env,isolate2]) {
     const a=await (await f.request('/m/ficticio-a/api/v1/menu',env)).json() as {version:number;catalog:{name:string}};assert.equal(a.version,2);assert.equal(a.catalog.name,'Ficticio A actualizado');
     const b=await (await f.request('/m/ficticio-b/api/v1/menu',env)).json() as {version:number;catalog:{name:string}};assert.equal(b.version,1);assert.equal(b.catalog.name,'Ficticio B');
   }
 }finally{f.sqlite.close();}
});

void test('owner domain and QR read existing canonical readable path without reserving new resources',async()=>{
 const f=await fixture();try{
  const {AuthSecurity}=await import('../lib/auth-security');const security=new AuthSecurity({DB:f.sql,DATA_PROVIDER:'d1-documents'});
  const session=await security.createSession('owner',f.a);
  const request=(path:string)=>worker.fetch(new Request(origin+'/r/'+f.a+'/api/v1/'+path,{headers:{cookie:session.cookie.split(';')[0]}}),f.env,context);
  const before=f.sqlite.prepare('SELECT COUNT(*) AS n FROM operational_documents').get() as {n:number};
  const domain=await request('domain');assert.equal(domain.status,200);assert.equal((await domain.json() as {primaryUrl:string}).primaryUrl,origin+'/m/ficticio-a');
  const qr=await request('qr');assert.equal(qr.status,200);assert.equal((await qr.json() as {codes:{payload:string}[]}).codes[0].payload,origin+'/m/ficticio-a');
  const after=f.sqlite.prepare('SELECT COUNT(*) AS n FROM operational_documents').get() as {n:number};assert.equal(after.n,before.n);
 }finally{f.sqlite.close();}
});


